"use strict";

const EventEmitter = require("events");
const {DistributedCounter} = require("./broker/dcounter");
const {DistributedMap} = require("./broker/dmap");
const {toMessage} = require("./util");

const ROOMS = new Map();

const LOADING = Symbol();

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
    this.userCount = new DistributedCounter(`rc:${this.roomid}`);
    this.userCount.on("update", v => {
      if (v === this.lastUserCount) {
        return;
      }
      this.lastUserCount = v;
      this.emit("usercount", v);
    });
    this.lastUserCount = 0;

    this.config = new DistributedMap(`rco:${this.roomid}`);

    this[LOADING] = (async() => {
      await this.config.loaded;
      if (!this.config.has("roomname")) {
        this.config.set("roomname", "New Room");
      }
      this.config.on("set", (key, rn) => {
        this.emit("config", key, rn);
      });
    })();

    Object.seal(this);
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

  cmd_motd(client) {
    client.sendMOTD();
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

  async ref() {
    await this.load();
    this.userCount.increment();
    this.lastUserCount = this.userCount.value;
    this.emit("usercount", this.lastUserCount);
  }

  unref() {
    this.userCount.decrement();
    if (this.userCount.local) {
      return;
    }
    this.emit("sudoku", this);
    console.log("SUDOKU", this.roomid);
    this.removeAllListeners();
    this.userCount.kill();
    this.config.kill();
    ROOMS.delete(this.roomid);
  }
}

module.exports = { Room };
