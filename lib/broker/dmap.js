"use strict";

const BROKER = require("./");
const {ObservableMap} = require("../omap");

const PID = Symbol();
const KEY = Symbol();
const LOADING = Symbol();

// XXX locks?

class DistributedMap extends ObservableMap {
  constructor(key) {
    super();
    this[PID] = process.pid;
    this[KEY] = `map:${key}`;
    this.onsync = this.onsync.bind(this);
    BROKER.on(this[KEY], this.onsync);
    this[LOADING] = new Promise((resolve, reject) => {
      BROKER.PUB.hgetall(this[KEY], (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        super.clear();
        if (!data) {
          resolve();
          return;
        }
        for (const [sk, sv] of Object.entries(data)) {
          const [k, v] = [JSON.parse(sk), JSON.parse(sv)];
          super.set(k, v);
        }
        resolve();
      });
    });
  }

  get loaded() {
    return this[LOADING];
  }

  onsync(d) {
    if (d.pid === this[PID]) {
      return;
    }
    switch (d.t) {
    case "s":
      super.set(d.k, d.v);
      return;

    case "d":
      super.delete(d.k);
      return;

    case "c":
      super.clear();
      return;

    default:
      console.error("invalid op", this[KEY], d);
      return;
    }
  }

  set(k, v) {
    const [sk, sv] = [JSON.stringify(k), JSON.stringify(v)];
    BROKER.PUB.hpset(this[KEY], this[PID], sk, sv);
    return super.set(k, v);
  }

  delete(k) {
    const sk = JSON.stringify(k);
    BROKER.PUB.hpdel(this[KEY], this[PID], sk);
    return super.delete(k);
  }

  clear() {
    BROKER.PUB.hpclear(this[KEY], this[PID]);
    return super.clear();
  }

  kill() {
    BROKER.removeListener(this[KEY], this.onsync);
    super.clear();
  }
}

module.exports = { DistributedMap };
