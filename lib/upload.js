"use strict";

const EventEmitter = require("events");
const send = require("send");
const blake2 = require("blake2");
const CONFIG = require("./config");
const BROKER = require("./broker");
const {getMetaData, generateAssets} = require("./meta");
const {
  DistributedMap,
  DistributedSet,
  RemoteMap,
} = require("./broker/collections");
const {ofilter, sort} = require("./util");
const bans = require("./bans");
const {StorageLocation, STORAGE} = require("./storage");
const {HashesSet} = require("./hashesset");

const SECSPERHOUR = 3600;
const EXPIRE_PENDING = CONFIG.get("pendingTTL") * SECSPERHOUR;
const EXPIRE_UPLOAD = CONFIG.get("TTL");
const DELAY = CONFIG.get("delayServe") || 0;
const FORCE_NEW_STORAGE = CONFIG.get("forceNewStorage") || 0;

const redis = BROKER.getMethods(
  "del", "expire", "ttl", "get", "set",
  "hget", "hgetall", "hset", "hsetnx"
);

const PENDING = new DistributedSet("upload:pending");
const UPLOADS = new DistributedMap("upload:uploads", v => new Upload(v));

const BLACKLIST = new RemoteMap("upload:blacklist");

function topkey(s) {
  return `upload:p:${s}`;
}

const UPLOAD_OFILTER = new Set([
  "key", "href", "type",
  "name", "size", "roomid", "ip", "hash",
  "tags", "meta",
  "uploaded", "expires",
]);

class Upload extends EventEmitter {
  constructor(options) {
    super();
    Object.assign(this, options);

    if (!this.name) {
      throw new Error("no name");
    }
    if (!STORAGE.has(this.hash)) {
      throw new Error("invalid storage");
    }
    Object.seal(this);
  }

  get storage() {
    return STORAGE.get(this.hash);
  }

  get expired() {
    return this.expires < Date.now();
  }

  get hidden() {
    if (!this.tags || !this.storage || !this.storage.tags) {
      console.warn("somehow corrupted download", JSON.stringify(this), this);
      // Just say it's hidden for now
      return true;
    }

    return this.tags && this.tags.hidden || this.storage.tags.hidden;
  }

  get TTL() {
    return Math.max(0, this.expires - Date.now());
  }

  async expire() {
    if (!this.expired) {
      return false;
    }
    this.emit("expired");
    await this.remove();
    return true;
  }

  async remove() {
    if (this.storage) {
      if (await this.storage.unref(this.key)) {
        STORAGE.delete(this.hash);
      }
    }
    this.emit("removed");
  }

  toJSON() {
    return ofilter(this, UPLOAD_OFILTER);
  }

  toClientJSON() {
    const {storage, tags = {}} = this;
    if (!storage) {
      return Object.assign(this.toJSON(), { assets: [] });
    }
    return Object.assign(this.toJSON(), {
      assets: Array.from(storage.assets),
      tags: Object.assign({}, storage.tags, tags),
    });
  }

  toString() {
    return `Upload(${this.key}, ${this.size}, ${this.hash})`;
  }

  static async create(u, ttl) {
    const now = Date.now();
    const rv = new Upload(Object.assign(u, {
      uploaded: now,
      expires: now + (ttl || EXPIRE_UPLOAD) * SECSPERHOUR * 1000,
    }));
    await rv.storage.ref(rv.key);
    return rv;
  }

  static async get(key) {
    await UPLOADS.loaded;
    return UPLOADS.get(key);
  }
}

class UploadError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

class RetryableError extends UploadError {
  constructor(message, code) {
    super(message, code);
    this.retryable = true;
  }
}

async function realupload(req, res) {
  try {
    req.setTimeout(0);
    const {name, offset: soffset} = req.query;
    const {key} = req.params;
    const offset = parseInt(soffset, 10);
    if (!key || typeof key !== "string") {
      throw new UploadError("No key provided", 1);
    }

    const {headers: {"content-length": cl = -1} = {}} = req;
    const limit = CONFIG.get("maxFileSize");
    if (limit > 0 && cl >= 0 && cl > limit) {
      throw new UploadError("File too large", 5);
    }

    const pkey = topkey(key);
    let cachedError = await redis.get(`error:${pkey}`);
    if (cachedError) {
      cachedError = JSON.parse(cachedError);
      console.warn("Re-throwing upload error from cache", cachedError);
      throw new UploadError(cachedError.err, cachedError.code);
    }

    let storage;
    try {
      if (!name || typeof name !== "string") {
        throw new UploadError("Invalid name", 2);
      }
      if (name.length > 256) {
        throw new UploadError("File name too long", 2);
      }
      if (!isFinite(offset) || offset < 0) {
        throw new UploadError("Invalid offset", 3);
      }
      const {user: acct} = req;
      const mod = acct && acct.role === "mod";
      if (!mod) {
        const ban = await bans.findBan("upload", req.ip, acct && acct.account);
        if (ban) {
          throw new UploadError(ban.toUserMessage("upload"), 9001);
        }
      }

      const pending = await redis.hgetall(pkey);
      if (!pending) {
        throw new UploadError(`Unknown key ${key}`, 4);
      }
      if (parseInt(pending.offset, 10) !== offset) {
        throw new RetryableError("Bad offset", 5);
      }

      storage = new StorageLocation(key);
      console.log(`Upload to ${storage} started`);

      const file = await storage.openWriteAt(offset);
      const hasher = blake2.createHash("blake2b", {digestLength: 30});
      if (pending.hashstate) {
        hasher.restoreState(pending.hashstate, "base64");
      }
      let length = offset;
      let lastCheckpointLength = length;

      // can be 0=prematurely, -1=retryable, 1=ended otherwise
      let ended = 0;

      await new Promise((resolve, reject) => {
        file.on("finish", resolve);
        file.on("error", reject);
        req.on("error", connex => {
          switch ((connex || {}).code) {
          case "ECONNRESET":

            // falls through
          case "ETIMEDOUT":

            // falls through
          case "ECONNABORTED":
            console.warn("Recoverable network error on", key, ":", connex);
            ended = -1;
            file.end();
            // ignore these
            break;
          default:
            reject(connex);
            break;
          }
        });
        req.on("end", () => {
          file.end();
          if (!ended) {
            ended = 1;
          }
        });
        req.on("close", () => {
          file.end();
        });
        req.on("data", data => {
          length += data.length || 0;
          if (limit > 0 && length > limit) {
            // Unlikely to happen
            // But if it happens, then funny things will happen in the browser
            req.pause();
            file.end();
            req.destroy(new UploadError("File too large", 5));
            return;
          }

          file.write(data);
          hasher.update(data);

          // Checkpointing, so we can recover more easily from server resets
          // Currently every 10M of new data
          if (lastCheckpointLength + (10 * 1024 * 1024) < length) {
            const state = hasher.saveState("base64");
            const curOffset = length;
            (async () => {
              await redis.hset(pkey, "hashstate", state);
              await redis.hset(pkey, "offset", curOffset);
            })().catch(console.error);
            lastCheckpointLength = length;
          }
        });
      });
      if (limit > 0 && length > limit) {
        throw new UploadError("File too large", 5);
      }
      const newOffset = offset + file.bytesWritten;
      if (ended <= 0) {
        const state = hasher.saveState("base64");
        await redis.hset(pkey, "hashstate", state);
        await redis.hset(pkey, "offset", newOffset);
        throw new RetryableError("Interrupted", 6);
      }
      const hash = hasher.digest("base64");
      const written = offset + file.bytesWritten;

      const blacked = mod ? null : await BLACKLIST.get(hash);

      // Lookup storage for dedupe
      await Promise.all([STORAGE.loaded, UPLOADS.loaded, PENDING.loaded]);
      let newStorage = FORCE_NEW_STORAGE ? null : STORAGE.get(hash);
      if (!newStorage) {
        newStorage = storage;
        try {
          const {type, mime, tags, meta} = await getMetaData(storage, name);
          newStorage = new StorageLocation({
            name: storage.name,
            hash,
            type,
            mime,
            tags,
            meta,
            size: written,
          });
        }
        catch (ex) {
          console.error(`Failed to get metadata for: ${storage}`, ex);
        }
        if (blacked) {
          newStorage.hidden = true;
        }
        STORAGE.set(hash, newStorage);
        console.info("New storage");
      }
      else {
        await storage.rm();
        storage = null;
        console.info("Known storage");
      }

      let {user} = pending;
      let role = "white";
      let account = "";
      if (acct) {
        await acct.addUpload(written);
        role = acct.role || role;
        user = acct.name || user;
        account = acct.account || account;
      }

      const tags = role !== "white" ? { user } : { usernick: user };
      const hellban = mod ? null : await bans.findBan(
        "hellban", req.ip, acct && acct.account);
      if (hellban) {
        tags.hidden = true;
      }

      const upload = await Upload.create({
        key,
        href: `/g/${key}`,
        name,
        size: written,
        roomid: pending.roomid,
        type: newStorage.type,
        tags,
        meta: Object.assign({
          account,
          role
        }, newStorage.meta),
        ip: req.ip,
        hash,
      }, pending.ttl);
      UPLOADS.set(key, upload);

      if (blacked) {
        const subjects = {
          ips: [req.ip],
          accounts: [],
        };
        if (acct) {
          subjects.accounts.push(acct.account);
        }
        await bans.ban(
          pending.roomid,
          {
            name: "BLACKLIST",
            role: "system",
          },
          subjects,
          blacked,
          [upload]);
      }

      // Revoke Key
      PENDING.delete(key);
      await redis.del(pkey);

      console.log(`Uploaded ${upload.toString().bold}`);
      res.json({key});
      if (storage) {
        generateAssets(newStorage).catch(console.error);
      }
    }
    catch (ex) {
      if (!ex.retryable) {
        // Revoke key
        await PENDING.loaded;
        PENDING.delete(key);
        await redis.del(pkey);
        const cached = {
          err: ex.message || ex.toString(),
          code: ex.code || -1,
        };
        console.warn("Irrecoverable error on", key, ":", cached);
        await redis.set(`error:${pkey}`, JSON.stringify(cached), "EX", 240);
      }
      if (!ex.retryable && storage) {
        // Remove partial files
        try {
          await storage.rm();
        }
        catch (iex) {
          console.log(`Failed to remove storage: ${storage}`);
        }
      }
      throw ex;
    }
  }
  catch (ex) {
    const error = {
      err: ex.message || ex.toString(),
      code: ex.code || -1,
      retryable: ex.retryable || false
    };
    res.json(error);
    res.end();
  }
}

async function registerUploadKey(roomid, user, key, ttl) {
  const ckey = topkey(key);
  try {
    if (!await redis.hsetnx(ckey, "key", key)) {
      throw new Error("Already registered");
    }
    if (!await redis.hsetnx(ckey, "roomid", roomid)) {
      throw new Error("Already registered");
    }
    if (!await redis.hsetnx(ckey, "user", user)) {
      throw new Error("Already registered");
    }
    if (!await redis.hsetnx(ckey, "offset", 0)) {
      throw new Error("Already registered");
    }
    if (!await redis.hsetnx(ckey, "ttl", ttl)) {
      throw new Error("Already registered");
    }
    await redis.expire(ckey, EXPIRE_PENDING);
    await PENDING.loaded;
    PENDING.add(key);
  }
  catch (ex) {
    console.error(ex);
    throw new Error("Failed to register upload key");
  }
}

async function queryOffset(key) {
  const off = await redis.hget(topkey(key), "offset");
  if (off === null) {
    throw new UploadError(`Cannot query offset of unknown key ${key}`, 5);
  }
  return parseInt(off, 10);
}

function upload(req, res, next) {
  realupload(req, res).
    catch(ex => {
      console.error("errored", ex);
      next();
    });
}

class Expirer {
  constructor() {
    this.uploads = (async() => {
      const a = [];
      let added = 0;
      await UPLOADS.loaded;
      UPLOADS.on("set", (_, v) => {
        a.push(v);
        if (++added >= 1) {
          sort(a, f => f.expires);
          added = 0;
        }
      });
      a.push(...UPLOADS.values());
      return sort(a, f => f.expires);
    })();
  }

  async expireUploads() {
    const uploads = await this.uploads;
    for (;;) {
      const [upload] = uploads;
      if (!upload) {
        break;
      }
      try {
        if (!await upload.expire()) {
          return;
        }
        UPLOADS.delete(upload.key);
        uploads.shift();
      }
      catch (ex) {
        console.error(`Failed to remove ${upload}`, ex);
        uploads.shift();
      }
    }
  }

  async expirePending() {
    await PENDING.loaded;
    PENDING.forEach(async v => {
      const alive = await redis.ttl(topkey(v));
      if (alive < -1) {
        try {
          if (v) {
            const storage = new StorageLocation(v);
            console.log(`Killing expired pending upload ${storage}`);
            await storage.rm();
          }
        }
        catch (ex) {
          console.error(`Failed to remove ${v}`);
        }
        finally {
          PENDING.delete(v);
        }
      }
    });
  }

  async expire() {
    try {
      await this.expirePending();
    }
    catch (ex) {
      console.error("Failed to expire pending", ex);
    }
    try {
      await this.expireUploads();
    }
    catch (ex) {
      console.error("Failed to expire pending", ex);
    }
  }
}

const EMITTER = new class UploadEmitter extends EventEmitter {
  constructor() {
    super();
    this.cache = new WeakMap(); // room -> cached file list
    this.hashes = new HashesSet();
    UPLOADS.loaded.then(() => {
      for (const u of UPLOADS.values()) {
        this.hashes.add(u);
      }
    });
    UPLOADS.on("set", (_, v) => {
      this.hashes.add(v);
      if (!v.expired) {
        this.emit(v.roomid, "add", v);
      }
      this.cache = new WeakMap();
    });
    UPLOADS.on("update", (_, v) => {
      this.hashes.update(v);
      if (!v.expired) {
        this.emit(v.roomid, "update", v);
      }
      this.cache = new WeakMap();
    });
    UPLOADS.on("predelete", k => {
      const v = UPLOADS.get(k);
      if (!v) {
        return;
      }
      this.hashes.delete(v);
      this.emit(v.roomid, "delete", v);
      this.cache = new WeakMap();
    });
    UPLOADS.on("clear", () => {
      this.hashes.clear();
      this.cache = new WeakMap();
      this.emit("clear");
    });
    setInterval(() => {
      this.cache = new WeakMap();
    }, 5 * 60 * 1000);
  }

  async for(room) {
    await UPLOADS.loaded;
    let files = this.cache.get(room);
    if (!Array.isArray(files)) {
      files = Array.from(UPLOADS.values()).
        filter(v => v.roomid === room.roomid && !v.expired);
      this.cache.set(room, files);
    }
    return sort(files, f => f.uploaded);
  }

  async get(key) {
    await UPLOADS.loaded;
    return UPLOADS.get(key);
  }

  async trash(files) {
    for (const f of files) {
      UPLOADS.delete(f.key);
      await f.remove();
    }
  }

  _filesToFiles(files) {
    const hashes = new Set(files.map(f => f.hash));
    for (const h of hashes) {
      const mappedFiles = this.hashes.get(h);
      if (!mappedFiles) {
        continue;
      }
      files.push(...Array.from(mappedFiles));
    }
    files = sort(Array.from(new Set(files)), f => [f.roomid, f.name, f.key]);
    return files;
  }

  async blacklist(roomid, mod, options, files) {
    files = this._filesToFiles(files);
    const subjects = {
      accounts: [],
      ips: [],
    };
    for (const f of files) {
      const {storage} = f;
      if (!storage) {
        continue;
      }
      await BLACKLIST.set(storage.hash, options);
      // This will trigger an update in clients
      storage.hidden = true;
      subjects.ips.push(f.ip);
      if (f.meta && f.meta.account) {
        subjects.accounts.push(f.meta.account);
      }
    }
    subjects.ips = Array.from(new Set(subjects.ips));
    subjects.accounts = Array.from(new Set(subjects.accounts));
    await bans.ban(
      roomid,
      mod,
      subjects,
      options,
      files
    );
  }

  async whitelist(roomid, mod, files) {
    const hashes = new Set(files.map(f => f.hash));
    for (const h of hashes) {
      await BLACKLIST.delete(h);
    }

    // Whitelist all storages
    const allfiles = this._filesToFiles(files);
    for (const f of allfiles) {
      const {storage} = f;
      if (!storage) {
        continue;
      }
      // This will trigger an update in clients
      storage.hidden = false;
    }

    // Whitelist the actual files, but only in this room
    for (const f of files) {
      delete f.tags.hidden;
      // This will trigger an update in clients
      UPLOADS.set(f.key, f);
    }
    await bans.whitelist(
      roomid,
      mod,
      allfiles
    );
  }
}();

const sendOpts = {
  acceptRanges: true,
  cacheControl: false,
  dotfiles: "deny",
  etag: false,
  extensions: false,
  index: false,
  lastModified: true,
};

async function serve(req, res, next) {
  let {key} = req.params;
  try {
    if (!key) {
      throw new Error("Invalid key");
    }
    let asset;
    const idx = key.indexOf(".");
    if (idx >= 0) {
      asset = key.slice(idx);
      key = key.slice(0, idx);
    }
    const up = await UPLOADS.get(key);
    if (!up) {
      throw new Error("Unregistered key");
    }
    const {storage} = up;
    if (!storage) {
      throw new Error("No storage");
    }

    if (up.hidden) {
      const {user} = req;
      if (req.ip !== up.ip && (!user || user.role !== "mod")) {
        throw new Error("hidden");
      }
    }

    let {mime, full: path} = storage;
    if (asset) {
      asset = storage.assets.get(asset);
      if (!asset) {
        throw new Error("Invalid asset");
      }
      const {mime: amime} = asset;
      mime = amime || mime;
      path = storage.full + asset.ext;
    }

    if (DELAY) {
      await new Promise(r => setTimeout(r, DELAY));
    }

    const s = send(req, path, sendOpts);
    s.on("headers", res => {
      res.setHeader("Content-Type", mime);
      res.setHeader("Etag", `"${key}"`);
      res.setHeader("Cache-Control", `public, immutable, max-age=${(up.TTL / 1000) | 0}, no-transform`);
    });
    s.on("error", next);
    s.pipe(res);
  }
  catch (ex) {
    // Consider this Not Found
    next();
  }
}

function resolve(key) {
  let u = UPLOADS.get(key);
  if (!u || u.expired) {
    u = null;
  }
  return u;
}

module.exports = {
  EMITTER,
  UPLOADS,
  Expirer,
  queryOffset,
  registerUploadKey,
  serve,
  upload,
  resolve,
};
