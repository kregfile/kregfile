"use strict";

const EventEmitter = require("events");
const {DistributedCounter} = require("./dcounter");
const {DistributedMap} = require("./dmap");

const ROOMS = new Map();

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

    Object.seal(this);
  }

  async load() {
    await this.config.loaded;
    if (!this.config.has("roomname")) {
      this.config.set("roomname", "New Room");
    }
    this.emit("config-loaded", Array.from(this.config));
    this.config.on("set", (key, rn) => {
      this.emit("config", key, rn);
    });
  }

  cmd_kek(arg) {
    return `*hue ${arg}`;
  }

  cmd_name(arg) {
    if (arg.length < 3 || arg.length > 20) {
      throw new Error("Invalid room name");
    }
    this.config.set("roomname", arg);
    return `Changed room name to: ${arg}`;
  }

  doCommand(cmd) {
    const fn = this[`cmd_${cmd.cmd}`];
    if (!fn) {
      throw new Error(`No such command: ${cmd.cmd}`);
    }
    return fn.call(this, cmd.args);
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
