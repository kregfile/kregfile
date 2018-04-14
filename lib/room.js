"use strict";

const EventEmitter = require("events");
const {DistributedTracking} = require("./broker/dtracking");
const {DistributedMap} = require("./broker/dmap");
const {debounce, toMessage} = require("./util");

const LOADING = Symbol();

const ROOMS = new Map();
const USERCOUNT_DEBOUNCE = 5000;

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
      this.config.on("set", (key, rn) => {
        this.emit("config", key, rn);
      });
    })();

    Object.seal(this);
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
      this.config.set("motd", toMessage(arg));
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
    if (this.clients.incr(ip) === 1) {
      this.lastUserCount++;
    }
    this.emit("usercount", this.lastUserCount);
  }

  unref(ip) {
    this.clients.decr(ip);
    this.emit("sudoku", this);
    console.log("SUDOKU", this.roomid);
    this.removeAllListeners();
    this.config.kill();
    this.clients.kill();
    ROOMS.delete(this.roomid);
  }
}

module.exports = { Room };
