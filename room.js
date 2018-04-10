"use strict";

const EventEmitter = require("events");
const {DistributedCounter} = require("./dcounter");

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
    Object.seal(this);
  }

  ref() {
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
    ROOMS.delete(this.roomid);
  }
}

module.exports = { Room };
