"use strict";

const EventEmitter = require("events");
const {DistributedMap, DistributedTracking} = require("./broker/collections");
const {CoalescedUpdate, debounce, toMessage} = require("./util");
const {EMITTER: UPLOADS} = require("./upload");
const BROKER = require("./broker");

const LOADING = Symbol();

const ROOMS = new Map();
const USERCOUNT_DEBOUNCE = 5000;

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

  async for(role, ip) {
    if (this.dirty) {
      this.files = await UPLOADS.for(this.room.roomid);
      this.hashes = new Map(this.files.map(e => [e.hash, e]));
      this.ips = new Set(this.files.map(f => f.ip));
      this.privileged = this.files.
        map(f => f.toClientJSON());
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
