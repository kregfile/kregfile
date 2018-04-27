"use strict";

const EventEmitter = require("events");
const {
  DistributedMap,
  DistributedSet,
  DistributedTracking,
} = require("./broker/collections");
const {
  CoalescedUpdate,
  debounce,
  toMessage,
  token,
} = require("./util");
const {FloodProtector, roomFloods} = require("./tracking");
const {EMITTER: UPLOADS} = require("./upload");
const BROKER = require("./broker");
const {User} = require("./user");
const CONFIG = require("./config");

const LOADING = Symbol();

const ROOMS = new Map();
const USERCOUNT_DEBOUNCE = 5000;

const redis = BROKER.getMethods("exists", "set");

const EXPIRER = new CoalescedUpdate(60000, rooms => rooms.forEach(r => {
  if (r.maybeKill()) {
    return;
  }
  EXPIRER.add(r);
}));

function sanitizeFile(file) {
  file = file.toClientJSON();
  delete file.ip;
  delete file.admin;
  return file;
}

class FileLister {
  constructor(room) {
    this.room = room;
    this.files = [];
    this.lastFiles = new Map();
    this.hashes = new Map();
    this.privileged = [];
    this.regular = [];
    this.ips = new Set();
    this.dirty = true;

    this.onadded = new CoalescedUpdate(1000, files => {
      files.forEach(e => {
        const j = JSON.stringify(e.toClientJSON());
        this.lastFiles.set(e.key, j);
      });
      this.room.emit("files", "add", files);
    });

    this.ondeleted = new CoalescedUpdate(250, files => {
      files.forEach(e => {
        this.lastFiles.delete(e.key);
      });
      this.room.emit("files", "deleted", files);
    });

    this.onupdated = new CoalescedUpdate(2000, files => {
      files = files.filter(e => {
        const j = JSON.stringify(e.toClientJSON());
        const rv = this.lastFiles.get(e.key) !== j;
        this.lastFiles.set(e.key, j);
        return rv;
      });
      if (!files.length) {
        return;
      }
      this.room.emit("files", "updated", files);
    });

    this.onfile = this.onfile.bind(this);
    this.onupdatestorage = this.onupdatestorage.bind(this);
    this.onclear = this.onclear.bind(this);
    Object.seal(this);

    UPLOADS.on(this.room.roomid, this.onfile);
    BROKER.on("update-storage", this.onupdatestorage);
    UPLOADS.on("clear", this.onclear);
  }

  onfile(action, file) {
    if (action === "add") {
      this.files.push(file);
      this.hashes.set(file.hash, file);
      this.dirty = true;
      this.onadded.add(file);
      return;
    }
    if (action === "delete") {
      const idx = this.files.findIndex(e => file === e);
      if (idx < 0) {
        return;
      }
      this.files.splice(idx, 1);
      this.hashes.delete(file.hash);
      this.dirty = true;
      this.ondeleted.add(file);
      return;
    }
    console.warn("Upload action not handled", action);
  }

  onupdatestorage(hash) {
    const file = this.hashes.get(hash);
    if (!file) {
      return;
    }
    this.onupdated.add(file);
  }

  onclear() {
    this.files.length = 0;
    this.hashes.clear();
    this.regular.length = 0;
    this.ips.clear();
    this.dirty = false;
    this.room.emit("clear");
  }

  async trash(files) {
    await this.undirty();
    files = new Set(files);
    files = this.files.filter(e => files.has(e.key));
    await UPLOADS.trash(files);
    return files.length;
  }

  async undirty() {
    if (!this.dirty) {
      return;
    }
    this.files = await UPLOADS.for(this.room);
    this.hashes = new Map(this.files.map(e => [e.hash, e]));
    this.ips = new Set(this.files.map(f => f.ip));
    this.privileged = this.files.
      map(f => f.toClientJSON());
    this.regular = this.files.
      filter(f => !f.tags.hidden).
      map(sanitizeFile);
    this.dirty = false;
  }

  async for(role, ip) {
    await this.undirty();
    if (role === "mod") {
      return this.privileged;
    }
    if (this.ips.has(ip)) {
      return this.files.
        filter(f => !f.tags.hidden || f.ip === ip).
        map(sanitizeFile);
    }
    return this.regular;
  }

  async get(key, role, ip) {
    const file = await UPLOADS.get(key);
    if (!file) {
      throw new Error("Unknown file");
    }
    if (role === "mod") {
      return file.toClientJSON();
    }
    if (file.ip !== ip && file.hidden) {
      throw new Error("Unknown file");
    }
    return sanitizeFile(file);
  }

  convert(files, role, ip) {
    if (role === "mod") {
      return files.map(f => f.toClientJSON());
    }
    return files.
      filter(f => !f.tags.hidden || f.ip === ip).
      map(sanitizeFile);
  }

  kill() {
    UPLOADS.removeListener(this.room.roomid, this.onfile);
    BROKER.removeListener("update-storage", this.onupdatestorage);
    UPLOADS.removeListener("clear", this.onclear);
    this.files.length = this.regular.length = 0;
    this.ips.clear();
  }
}

class Room extends EventEmitter {
  static async get(roomid) {
    let room = ROOMS.get(roomid);
    if (!room) {
      const exists = await redis.exists(`rooms:${roomid}`);
      if (!exists) {
        return null;
      }
      ROOMS.set(roomid, room = new Room(roomid));
    }
    await room[LOADING];
    EXPIRER.add(room);
    return room;
  }

  static async create(ip, user, rtoken) {
    if (!user || user.role !== "mod") {
      const fp = new FloodProtector(
        `flood:${ip}`,
        roomFloods,
        CONFIG.get("roomFloodTrigger"),
        CONFIG.get("roomFloodDuration")
      );
      if (await fp.flooding()) {
        throw new Error("Cannot create this many rooms m8");
      }
    }
    let room;
    for (;;) {
      const roomid = await token(10);
      const created = await redis.set(`rooms:${roomid}`, Date.now(), "NX");
      if (created === "OK") {
        room = new Room(roomid);
        break;
      }
    }
    ROOMS.set(room.roomid, room);
    await room[LOADING];
    EXPIRER.add(room);
    if (user) {
      room.addOwner(user.account);
    }
    else if (token) {
      room.setTempOwner(rtoken);
    }
    return room;
  }

  constructor(roomid) {
    super();
    this.setMaxListeners(0);
    this.roomid = roomid;
    this.lastUserCount = 0;
    this.localUserCount = 0;
    this.files = new FileLister(this);

    this.config = new DistributedMap(`rco:${this.roomid}`);
    this.pconfig = new DistributedMap(`rpco:${this.roomid}`);
    this.owners = new DistributedSet(`rowners:${this.roomid}`);

    this.clients = new DistributedTracking(`clients:${this.roomid}`);
    this.clients.on("update", debounce(() => {
      this.usercount = this.clients.size;
    }, USERCOUNT_DEBOUNCE));

    this[LOADING] = (async() => {
      await this.config.loaded;
      await this.pconfig.loaded;
      await this.owners.loaded;
      await this.clients.laded;
      if (!this.config.has("roomname")) {
        this.config.set("roomname", "New Room");
      }
      this.config.on("set", (key, val) => {
        this.emit("config", key, val);
      });
    })();

    Object.seal(this);
    console.log(`Tracking room ${this.toString().bold}`);
  }

  get usercount() {
    return this.lastUserCount;
  }

  set usercount(nv) {
    if (this.lastUserCount === nv) {
      return;
    }
    this.emit("usercount", this.lastUserCount = nv);
  }

  addOwner(owner) {
    if (!owner) {
      throw new Error("Invalid owner");
    }
    if (this.owners.has(owner)) {
      throw new Error(`${owner} is already an owner!`);
    }
    this.owners.add(owner);
    this.config.set("owners", Array.from(this.owners));
  }

  removeOwner(owner) {
    if (!owner) {
      throw new Error("Invalid owner");
    }
    if (!this.owners.delete(owner)) {
      throw new Error(`${owner} isn't an owner!`);
    }
    this.config.set("owners", Array.from(this.owners));
  }

  setTempOwner(rtoken) {
    if (!rtoken) {
      throw new Error("Invalid owner token");
    }
    this.pconfig.set("towner", rtoken);
  }

  owns(acct, rtoken) {
    return (acct && this.owners.has(acct)) ||
      (rtoken && rtoken === this.pconfig.get("towner"));
  }

  ensureRights(client) {
    if (!client.privileged) {
      throw new Error("Only owners can do that!");
    }
  }

  cmd_kek(client, arg) {
    return `*hue ${arg}`;
  }

  cmd_name(client, arg) {
    this.ensureRights(client);
    if (arg.length < 3 || arg.length > 20) {
      throw new Error("Invalid room name");
    }
    this.config.set("roomname", arg);
    return `Changed room name to: ${arg}`;
  }

  async cmd_addowner(client, arg) {
    this.ensureRights(client);
    arg = arg.trim();
    const account = arg.toLowerCase();
    if (!await User.exists(account)) {
      throw new Error("Invalid account");
    }
    this.addOwner(account);
    return `${arg} added as an owner`;
  }

  async cmd_removeowner(client, arg) {
    this.ensureRights(client);
    arg = arg.trim();
    const account = arg.toLowerCase();
    if (!await User.exists(account)) {
      throw new Error("Invalid account");
    }
    this.removeOwner(account);
    return `${arg} removed as an owner`;
  }

  cmd_setmotd(client, arg) {
    this.ensureRights(client);
    if (!arg) {
      this.config.delete("motd");
      return "Removed MOTD";
    }
    if (arg.length > 500) {
      throw new Error("MOTD too long");
    }
    try {
      const motd = toMessage(arg);
      if (this.config.get("rawmotd") === arg) {
        return "";
      }
      this.config.set("rawmotd", arg);
      this.config.set("motd", motd);
    }
    catch (ex) {
      throw new Error("Invalid MOTD");
    }
    return "";
  }

  doCommand(client, cmd) {
    const fn = this[`cmd_${cmd.cmd}`];
    if (!fn) {
      throw new Error(`No such command: ${cmd.cmd}`);
    }
    return fn.call(this, client, cmd.args);
  }

  async getFilesFor(client) {
    return await this.files.for(client.role, client.ip);
  }

  async getFileInfo(key, client) {
    return await this.files.get(key, client.role, client.ip);
  }

  convertFiles(files, client) {
    return this.files.convert(files, client.role, client.ip);
  }

  ref() {
    this.localUserCount++;
  }

  async trackClient(ip) {
    await this[LOADING];
    if (ip && await this.clients.incr(ip) === 1) {
      this.lastUserCount++;
    }
    this.emit("usercount", this.lastUserCount);
  }

  async untrackClient(ip) {
    await this[LOADING];
    if (await this.clients.decr(ip) === 0) {
      this.lastUserCount--;
    }
    this.emit("usercount", this.lastUserCount);
  }

  unref() {
    this.localUserCount--;
  }

  maybeKill() {
    if (this.localUserCount > 0) {
      return false;
    }

    if (!ROOMS.delete(this.roomid)) {
      // Already gone
      return true;
    }

    this.emit("sudoku", this);
    console.log(`Untracked room ${this.toString().bold}`);
    this.removeAllListeners();
    this.config.kill();
    this.clients.kill();
    this.files.kill();
    return true;
  }

  async trash(files) {
    return await this.files.trash(files);
  }

  toString() {
    return `Room<${this.roomid}>`;
  }
}

module.exports = { Room };
