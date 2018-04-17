"use strict";

const EventEmitter = require("events");
const {DistributedMap, DistributedTracking} = require("./broker/collections");
const {CoalescedUpdate, debounce, toMessage} = require("./util");
const {EMITTER: UPLOADS} = require("./upload");

const LOADING = Symbol();

const ROOMS = new Map();
const USERCOUNT_DEBOUNCE = 5000;

function sanitizeFile(file) {
  file = file.toJSON();
  delete file.ip;
  delete file.storage;
  delete file.admin;
  return file;
}

class FileLister {
  constructor(room) {
    this.room = room;
    this.files = [];
    this.privileged = [];
    this.regular = [];
    this.ips = new Set();
    this.dirty = true;

    this.onadded = new CoalescedUpdate(1000, a => {
      this.room.emit("files", "add", a);
    });
    this.ondeleted = new CoalescedUpdate(250, a => {
      this.room.emit("files", "deleted", a);
    });

    this.onfile = this.onfile.bind(this);
    this.onclear = this.onclear.bind(this);
    Object.seal(this);

    UPLOADS.on(this.room.roomid, this.onfile);
    UPLOADS.on("clear", this.onclear);
  }

  onfile(action, file) {
    if (action === "add") {
      this.files.push(file);
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
      this.dirty = true;
      this.ondeleted.add(file);
      return;
    }
    console.warn("Upload action not handled", action);
  }

  onclear() {
    this.files.length = 0;
    this.regular.length = 0;
    this.ips.clear();
    this.dirty = false;
    this.room.emit("clear");
  }

  async for(role, ip) {
    if (this.dirty) {
      this.files = await UPLOADS.for(this.room.roomid);
      this.ips = new Set(this.files.map(f => f.ip));
      this.privileged = this.files.
        map(f => f.toJSON());
      this.regular = this.files.
        filter(f => !f.tags.hidden).
        map(sanitizeFile);
      this.dirty = false;
    }
    if (role === "admin") {
      return this.privileged;
    }
    if (this.ips.has(ip)) {
      return this.files.
        filter(f => !f.tags.hidden || f.ip === ip).
        map(sanitizeFile);
    }
    return this.regular;
  }

  convert(files, role, ip) {
    if (role === "admin") {
      return files.map(f => f.toJSON());
    }
    return files.
      filter(f => !f.tags.hidden || f.ip === ip).
      map(sanitizeFile);
  }

  kill() {
    UPLOADS.removeListener(this.room.roomid, this.onfile);
    UPLOADS.removeListener("clear", this.onclear);
    this.files.length = this.regular.length = 0;
    this.ips.clear();
  }
}

class Room extends EventEmitter {
  static get(roomid) {
    let rv = ROOMS.get(roomid);
    if (!rv) {
      ROOMS.set(roomid, rv = new Room(roomid));
    }
    return rv;
  }

  constructor(roomid) {
    super();
    this.setMaxListeners(0);
    this.roomid = roomid;
    this.lastUserCount = 0;
    this.files = new FileLister(this);

    this.config = new DistributedMap(`rco:${this.roomid}`);

    this.clients = new DistributedTracking(`clients:${this.roomid}`);
    this.clients.on("update", debounce(() => {
      this.usercount = this.clients.size;
    }, USERCOUNT_DEBOUNCE));

    this[LOADING] = (async() => {
      await this.config.loaded;
      await this.clients.loaded;
      if (!this.config.has("roomname")) {
        this.config.set("roomname", "New Room");
      }
      this.config.on("set", (key, val) => {
        this.emit("config", key, val);
      });
    })();

    Object.seal(this);
    console.log(`Tracking room ${this.roomid.bold}`);
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

  async load() {
    await this[LOADING];
    this.emit("config-loaded", Array.from(this.config));
  }

  cmd_kek(client, arg) {
    return `*hue ${arg}`;
  }

  cmd_name(client, arg) {
    if (arg.length < 3 || arg.length > 20) {
      throw new Error("Invalid room name");
    }
    this.config.set("roomname", arg);
    return `Changed room name to: ${arg}`;
  }

  cmd_setmotd(client, arg) {
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

  async ref(ip) {
    await this.load();
    if (await this.clients.incr(ip) === 1) {
      this.lastUserCount++;
    }
    this.emit("usercount", this.lastUserCount);
  }

  async getFilesFor(client) {
    return await this.files.for(client.role, client.ip);
  }

  convertFiles(files, client) {
    return this.files.convert(files, client.role, client.ip);
  }


  async unref(ip) {
    if (await this.clients.decr(ip)) {
      return;
    }
    this.emit("sudoku", this);
    console.log(`Untracked room ${this.roomid.bold}`);
    this.removeAllListeners();
    this.config.kill();
    this.clients.kill();
    this.files.kill();
    ROOMS.delete(this.roomid);
  }
}

module.exports = { Room };
