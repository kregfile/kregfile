"use strict";

const EventEmitter = require("events");
const BROKER = require("./");
const {debounce} = require("../util");

const KEY = Symbol();
const PKEY = Symbol();
const SYNCKEY = Symbol();
const EXPIRED = Symbol();
const VALUE = Symbol();
const CUT = 30000;

class DistributedCounter extends EventEmitter {
  constructor(key, initial) {
    super();
    this.local = isFinite(initial) ? initial : 0;

    this[KEY] = `counter:${key}`;
    this[PKEY] = process.pid;
    this[SYNCKEY] = `sync-${this[KEY]}`;
    this[EXPIRED] = 0;

    this.global = new Map();
    this[VALUE] = this.local;

    this.onsync = this.onsync.bind(this);
    this.scheduleSend = debounce(this.send.bind(this), 1000);
    this.scheduleEmit = debounce(this.doEmit.bind(this), 10000);
    BROKER.on(this[SYNCKEY], this.onsync);
    this.load();

    process.on("exit", () => {
      this.kill();
    });
    this.refresh = setInterval(() => this.send(), CUT / 2);
    Object.seal(this);
  }

  kill() {
    this.removeAllListeners();
    clearInterval(this.refresh);
    BROKER.removeListener(this[SYNCKEY], this.onsync);
    this.local = 0;
    this.send();
  }

  get value() {
    return this[VALUE];
  }

  load() {
    BROKER.PUB.hgetall(this[KEY], (err, data) => {
      if (err) {
        console.error(err);
        return;
      }
      data = data || {};
      let value = this.local;
      this.global.clear();
      const cut = Date.now() - CUT;
      const self = this[PKEY];
      for (const d of Object.values(data)) {
        const v = JSON.parse(d);
        if (self === v.key) {
          continue;
        }
        if (v.date < cut) {
          BROKER.PUB.hdel(this[KEY], v.key);
          continue;
        }
        value += v.value;
        this.global.set(v.key, v);
      }
      this[VALUE] = value;
      this[EXPIRED] = Date.now();
      this.emit("update", value);
      this.send();
    });
  }

  onsync(m) {
    const self = this[PKEY];
    if (m.key === self) {
      return;
    }

    if (m.value) {
      this.global.set(m.key, m);
    }
    else {
      this.global.delete(m.key);
    }

    // Force expire
    this[EXPIRED] = 0;
    this.scheduleEmit();
  }

  expire() {
    const now = Date.now();
    const cut = now - CUT;
    if (this[EXPIRED] > cut) {
      return;
    }
    this[EXPIRED] = now;

    const self = this[PKEY];
    let value = this.local;
    Array.from(this.global.values()).forEach(v => {
      if (self === v.key) {
        return;
      }
      if (v.date < cut) {
        this.global.delete(v.key);
        return;
      }
      value += v.value;
    });
    this[VALUE] = value;
  }

  doEmit() {
    this.expire();
    this.emit("update", this[VALUE]);
  }

  increment() {
    this.local++;
    this[VALUE]++;
    this.scheduleSend();
    this.scheduleEmit();
  }

  decrement() {
    this.local--;
    this[VALUE]--;
    this.scheduleSend();
    this.scheduleEmit();
  }

  send() {
    const o = {
      key: this[PKEY],
      value: this.local,
      date: Date.now(),
    };
    if (o.value) {
      BROKER.PUB.hset(this[KEY], this[PKEY], JSON.stringify(o));
    }
    else {
      BROKER.PUB.hdel(this[KEY], this[PKEY]);
    }
    BROKER.emit(this[SYNCKEY], o);
  }
}

module.exports = { DistributedCounter };
