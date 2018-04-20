"use strict";

const EventEmitter = require("events");
const {promisify} = require("util");
const send = require("send");
const blake2 = require("blake2");
let mkdirp = require("mkdirp");
const fs = require("fs");
const path = require("path");
const CONFIG = require("./config");
const BROKER = require("./broker");
const {getMetaData, generateAssets} = require("./meta");
const {DistributedMap, DistributedSet} = require("./broker/collections");
const {ofilter, sort} = require("./util");

const SECSPERHOUR = 3600;
const EXPIRE_PENDING = CONFIG.get("pendingTTL") * SECSPERHOUR;
const EXPIRE_UPLOAD = CONFIG.get("TTL") * SECSPERHOUR;
const UPLOADS_DIR = CONFIG.get("uploads");
const DELAY = CONFIG.get("delay_serve") || 0;

const del = promisify(BROKER.PUB.del.bind(BROKER.PUB));
const expire = promisify(BROKER.PUB.expire.bind(BROKER.PUB));
const hget = promisify(BROKER.PUB.hget.bind(BROKER.PUB));
const hgetall = promisify(BROKER.PUB.hgetall.bind(BROKER.PUB));
const hset = promisify(BROKER.PUB.hset.bind(BROKER.PUB));
const hsetnx = promisify(BROKER.PUB.hsetnx.bind(BROKER.PUB));
const ttl = promisify(BROKER.PUB.ttl.bind(BROKER.PUB));

const unlink = promisify(fs.unlink);
const rmdir = promisify(fs.rmdir);
const writeFile = promisify(fs.writeFile);
mkdirp = promisify(mkdirp);

const PENDING = new DistributedSet("upload:pending");
const STORAGE = new DistributedMap(
  "upload:storage", v => new StorageLocation(v));
const UPLOADS = new DistributedMap("upload:uploads", v => new Upload(v));

function topkey(s) {
  return `upload:p:${s}`;
}

function toskey(s) {
  return `upload:s:${s}`;
}

class StorageLocation {
  constructor(data) {
    this.meta = {};
    this.tags = {};
    this.assets = [];
    this.mime = "application/octet-stream";
    if (typeof data === "string") {
      this.name = data;
    }
    else {
      Object.assign(this, data);
    }
    if (Array.isArray(this.assets)) {
      this.assets = new Map(this.assets);
    }
    else {
      this.assets = new Map();
    }
    this.url = path.join("/", this.name[0], this.name[1], this.name);
    this.dir = path.join(UPLOADS_DIR, this.name[0], this.name[1]);
    this.full = path.join(this.dir, this.name);
    Object.freeze(this);
  }

  async _addAsset(asset) {
    try {
      if (!asset.ext || !asset.type || !asset.mime) {
        throw new Error("Trying to add an incomplete asset");
      }
      if (this.assets.has(asset.ext)) {
        return;
      }
      let full = this.full + asset.ext;
      const {data, file} = asset;
      if (file) {
        full = file;
        delete asset.file;
      }
      else if (!Buffer.isBuffer(data) || !data.length) {
        throw new Error("Trying to add invalid asset data");
      }
      else {
        await writeFile(full, data, {
          encoding: null
        });
      }
      delete asset.data;
      this.assets.set(asset.ext, Object.assign({}, asset));
    }
    catch (ex) {
      console.error(ex);
    }
  }

  async addAssets(assets) {
    if (!this.hash) {
      throw new Error("Cannot add assets to temporary storage");
    }
    await Promise.all(assets.map(this._addAsset.bind(this)));
    STORAGE.set(this.hash, this);
    console.warn("assets added", this.assets.size);
    BROKER.emit("update-storage", this.hash);
  }

  async mkdir() {
    await mkdirp(this.dir);
  }

  async ref(key) {
    const set = new DistributedSet(toskey(this.name));
    try {
      await set.loaded;
      set.add(key);
    }
    finally {
      set.kill();
    }
  }

  async unref(key) {
    const set = new DistributedSet(toskey(this.name));
    try {
      await set.loaded;
      set.delete(key);
      if (!set.size) {
        console.info(`Deleted ${this}`);
        await this.rm();
        return true;
      }
      return false;
    }
    finally {
      set.kill();
    }
  }

  async rm() {
    try {
      await unlink(this.full);
    }
    catch (ex) {
      console.error(`Failed to remove storage ${this.full}`);
    }
    for (const a of this.assets.values()) {
      try {
        await unlink(this.full + a.ext);
      }
      catch (ex) {
        console.error(`Failed to remove asset storage ${this.full}: `, a);
      }
    }
    try {
      await rmdir(this.dir);
    }
    catch (ex) {
      // ignored
    }
  }

  async openWriteAt(offset) {
    await mkdirp(this.dir);
    return fs.createWriteStream(this.full, {
      encoding: null,
      flags: offset ? "r+" : "w",
      start: offset,
    });
  }

  toJSON() {
    return {
      name: this.name,
      mime: this.mime,
      type: this.type,
      meta: this.meta,
      tags: this.tags,
      size: this.size,
      assets: Array.from(this.assets.entries()),
    };
  }

  toString() {
    return `StorageLocation(${this.full})`;
  }
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
    if (this.expires < Date.now()) {
      this.emit("expired");
      return true;
    }
    return false;
  }

  get TTL() {
    return Math.max(0, this.expires - Date.now());
  }

  async expire() {
    if (!this.expired) {
      return false;
    }
    if (this.storage) {
      if (await this.storage.unref(this.key)) {
        STORAGE.delete(this.hash);
      }
    }
    return true;
  }

  toJSON() {
    return ofilter(this, UPLOAD_OFILTER);
  }

  toClientJSON() {
    return Object.assign(this.toJSON(), {
      assets: Array.from(this.storage.assets),
    });
  }


  toString() {
    return `Upload(${this.key}, ${this.size}, ${this.hash})`;
  }

  static async create(u) {
    const now = Date.now();
    const rv = new Upload(Object.assign(u, {
      uploaded: now,
      expires: now + EXPIRE_UPLOAD * 1000,
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
    const {key, name, offset: soffset} = req.query;
    const offset = parseInt(soffset, 10);
    if (!key || typeof key !== "string") {
      throw new UploadError("No key provided", 1);
    }
    if (!name || typeof name !== "string") {
      throw new UploadError("Invalid name", 2);
    }
    if (name.length > 256) {
      throw new UploadError("File name too long", 2);
    }
    if (!isFinite(offset) || offset < 0) {
      throw new UploadError("Invalid offset", 3);
    }

    const pkey = topkey(key);
    const pending = await hgetall(pkey);
    if (!pending) {
      throw new Error("Unknown key", 4);
    }
    if (parseInt(pending.offset, 10) !== offset) {
      throw new RetryableError("Bad offset", 5);
    }

    let storage = new StorageLocation(key);
    console.log(`Upload to ${storage} started`);

    try {
      const file = await storage.openWriteAt(offset);
      const hasher = blake2.createHash("blake2b", {digestLength: 30});
      if (pending.hashstate) {
        hasher.restoreState(pending.hashstate, "base64");
      }
      req.on("data", data => {
        file.write(data);
        hasher.update(data);
      });
      let ended = false;
      await new Promise((resolve, reject) => {
        file.on("finish", resolve);
        file.on("error", reject);
        req.on("error", reject);
        req.on("end", () => {
          file.end();
          ended = true;
        });
        req.on("close", () => {
          file.end();
        });
      });
      if (!ended) {
        const state = hasher.saveState("base64");
        const newOffset = offset + file.bytesWritten;
        await hset(pkey, "hashstate", state);
        await hset(pkey, "offset", newOffset);
        throw new RetryableError("Interrupted", 6);
      }
      const hash = hasher.digest("base64");
      const written = offset + file.bytesWritten;

      // Lookup storage for dedupe
      await Promise.all([STORAGE.loaded, UPLOADS.loaded, PENDING.loaded]);
      let newStorage = null; //STORAGE.get(hash);
      if (!newStorage) {
        newStorage = storage;
        try {
          const {type, mime, tags, meta} = await getMetaData(storage.full);
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
          console.error(`Failed to get metadata for: ${storage}`);
        }
        STORAGE.set(hash, newStorage);
        console.info("New storage");
      }
      else {
        await storage.rm();
        storage = null;
        console.info("Known storage");
      }

      const upload = await Upload.create({
        key,
        href: `/g/${key}`,
        name,
        size: written,
        roomid: pending.roomid,
        type: newStorage.type,
        tags: Object.assign({
          user: pending.user,
        }, newStorage.tags),
        meta: newStorage.meta,
        ip: req.ip,
        hash,
      });
      UPLOADS.set(key, upload);

      // Revoke Key
      PENDING.delete(key);
      await del(pkey);

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
        await del(pkey);
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
    console.error(ex);
    res.json({
      err: ex.message || ex.toString(),
      code: ex.code || -1,
      retryable: ex.retryable || false
    });
  }
}

async function registerUploadKey(roomid, user, key) {
  const ckey = topkey(key);
  try {
    if (!await hsetnx(ckey, "key", key)) {
      throw new Error("Already registered");
    }
    if (!await hsetnx(ckey, "roomid", roomid)) {
      throw new Error("Already registered");
    }
    if (!await hsetnx(ckey, "user", user)) {
      throw new Error("Already registered");
    }
    if (!await hsetnx(ckey, "offset", 0)) {
      throw new Error("Already registered");
    }
    await expire(ckey, EXPIRE_PENDING);
    await PENDING.loaded;
    PENDING.add(key);
  }
  catch (ex) {
    console.error(ex);
    throw new Error("Failed to register upload key");
  }
}

async function queryOffset(key) {
  const off = await hget(topkey(key), "offset");
  if (off === null) {
    throw new Error("Unknown key", 5);
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
      const alive = await ttl(topkey(v));
      if (alive < -1) {
        const storage = new StorageLocation(v);
        console.log(`Killing expired pending upload ${storage}`);
        try {
          await storage.rm();
        }
        catch (ex) {
          console.error(`Failed to remove ${storage}`);
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
    UPLOADS.on("set", (_, v) => {
      if (!v.expired) {
        this.emit(v.roomid, "add", v);
      }
    });
    UPLOADS.on("predelete", k => {
      const v = UPLOADS.get(k);
      if (!v) {
        return;
      }
      this.emit(v.roomid, "delete", v);
    });
    UPLOADS.on("clear", this.emit.bind(this));
  }

  async for(roomid) {
    await UPLOADS.loaded;
    const files = Array.from(UPLOADS.values()).
      filter(v => v.roomid === roomid && !v.expired);
    return sort(files, f => f.uploaded);
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
  if (u.expired) {
    u = null;
  }
  return u;
}

module.exports = {
  EMITTER,
  Expirer,
  queryOffset,
  registerUploadKey,
  serve,
  upload,
  resolve,
};
