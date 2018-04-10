"use strict";

const BROKER = require("./broker");
const {ObservableMap} = require("./omap");

const KEY = Symbol();
const LOADING = Symbol();
const SYNCKEY = Symbol();


// XXX locks?

class DistributedMap extends ObservableMap {
  constructor(key) {
    super();
    this[KEY] = `map:${key}`;
    this[SYNCKEY] = `sync-${this[KEY]}`;
    this.onsync = this.onsync.bind(this);
    BROKER.on(this[SYNCKEY], this.onsync);
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
    BROKER.PUB.hset(this[KEY], sk, sv);
    BROKER.emit(this[SYNCKEY], {t: "s", k, v});
    return super.set(k, v);
  }

  delete(k) {
    const sk = JSON.stringify(k);
    BROKER.PUB.hdel(this[KEY], sk);
    BROKER.emit(this[SYNCKEY], {t: "d", k});
    return super.delete(k);
  }

  clear() {
    BROKER.PUB.del(this[KEY]);
    BROKER.emit(this[SYNCKEY], {t: "c"});
    return super.clear();
  }

  kill() {
    BROKER.removeListener(this[SYNCKEY], this.onsync);
    super.clear();
  }
}

module.exports = { DistributedMap };
