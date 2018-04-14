"use strict";

const EventEmitter = require("events");
const {promisify} = require("util");
const BROKER = require("./");

const KEY = Symbol();
const PID = Symbol();
const MAP = Symbol();
const LOADING = Symbol();
const REFRESH = Symbol();

const EXPIRE = 60 * 3 / 4;

const tracking = promisify(BROKER.PUB.tracking.bind(BROKER.PUB));

class DistributedTracking extends EventEmitter {
  constructor(key) {
    super();
    this[KEY] = `tracking:${key}`;
    this[PID] = process.pid.toString();
    this[MAP] = new Map();
    this.onsync = this.onsync.bind(this);
    BROKER.on(this[KEY], this.onsync);
    this[LOADING] = (async () => {
      try {
        const data = JSON.parse(await tracking(this[KEY], "getall", this[PID]));
        if (Array.isArray(data)) {
          this[MAP] = new Map(data);
        }
        else {
          this[MAP].clear();
        }
        this.emit("load");
        this.emit("update");
      }
      catch (ex) {
        console.error("getallerr", ex);
      }
    })();
    this[REFRESH] = setInterval(() => {
      BROKER.PUB.tracking(this[KEY], "refresh", this[PID]);
    }, EXPIRE);

    Object.seal(this);
  }

  get loaded() {
    return this[LOADING];
  }

  onsync(t) {
    switch (t.op) {
    case "s": {
      const map = this[MAP];
      if (t.v) {
        map.set(t.k, t.v);
      }
      else {
        map.delete(t.k);
      }
      this.emit("update");
      return;
    }

    case "del":
      this[MAP].delete(t.k);
      this.emit("update");
      return;

    case "c":
      this[MAP].clear();
      this.emit("update");
      return;

    case "exp":
      if (Array.isArray(t.v)) {
        this[MAP] = new Map(t.v);
      }
      else {
        this[MAP].clear();
      }
      this.emit("update");
      return;

    default:
      throw new Error("invalid op");
    }
  }

  get size() {
    return this[MAP].size;
  }

  get(key) {
    return this[MAP].get(key) || 0;
  }

  async incr(key) {
    return await tracking(this[KEY], "incr", this[PID], key);
  }

  async decr(key) {
    return await tracking(this[KEY], "decr", this[PID], key);
  }

  async delete(key) {
    await tracking(this[KEY], "del", this[PID], key);
    return this[MAP].delete(key);
  }

  async clear() {
    await tracking(this[KEY], "clear", this[PID]);
    this[MAP].clear();
  }

  dump() {
    console.log(this[MAP]);
  }

  kill() {
    this.emit("kill");
    this.removeAllListeners();
    clearInterval(this[REFRESH]);
    BROKER.removeListener(this[KEY], this.onsync);
    this[MAP].clear();
  }
}

module.exports = { DistributedTracking };
