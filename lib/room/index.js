"use strict";

const EventEmitter = require("events");
const {
  DistributedMap,
  DistributedSet,
  DistributedTracking,
} = require("../broker/collections");
const {
  CoalescedUpdate,
  debounce,
  toMessage,
  token,
} = require("../util");
const {FloodProtector, roomFloods} = require("../tracking");
const BROKER = require("../broker");
const CONFIG = require("../config");
const bans = require("../bans");
const {FileLister} = require("./filelister");

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
      this.config.on("change", (key, val) => {
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

  async setMOTD(arg) {
    if (!arg) {
      this.config.delete("motd");
      return "Removed MOTD";
    }
    if (arg.length > 500) {
      throw new Error("MOTD too long");
    }
    try {
      const motd = await toMessage(arg);
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

  async ban(mod, subjects, opts) {
    await bans.ban(this.roomid, {
      name: mod.name,
      role: mod.role,
    }, subjects, opts);
  }

  async unban(mod, subjects, opts) {
    await bans.unban(this.roomid, {
      name: mod.name,
      role: mod.role,
    }, subjects, opts);
  }

  async nuke(mod) {
    this.config.set("disabled", true);
    this.config.set("roomname", "[closed]");
    await this.setMOTD("");
    await bans.nuke(this.roomid, mod);
  }

  async blacklist(mod, options, files) {
    await this.files.blacklist(mod, options, files);
  }

  async whitelist(mod, files) {
    await this.files.whitelist(mod, files);
  }

  toString() {
    return `Room<${this.roomid}>`;
  }
}

module.exports = { Room };
