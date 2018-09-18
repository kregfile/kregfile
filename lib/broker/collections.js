"use strict";

const EventEmitter = require("events");
const BROKER = require("./");
const {ObservableSet, ObservableMap} = require("../util");

const THIS_PID = process.pid.toString();
const PID = Symbol();
const KEY = Symbol();
const MAP = Symbol();
const QUEUED = Symbol();
const LOADING = Symbol();
const REFRESH = Symbol();
const UNSERIALIZE = Symbol();
const EXPIRE = 20 * 3 / 4;

const redis = BROKER.getMethods(
  "del",
  "hget", "hexists", "hgetall", "hdel", "hset",
  "sadd", "sismember", "smembers", "srem",
  "tracking"
);

function ensureKey(key) {
  switch (typeof key) {
  case "undefined":
    return {v: key};

  case "boolean":
    return {v: key};

  case "number":
    return {v: key};

  case "string":
    return {v: key};

  case "symbol": {
    const rv = Symbol.keyFor(key);
    if (!rv) {
      throw new Error("Invalid Symbol, must be Symbol.for()able");
    }
    return {s: rv};
  }

  default:
    if (key === null) {
      return {v: key};
    }
    throw new Error("Key is not a primitive type");
  }
}

function unserializeKey(key) {
  if (key.s) {
    return Symbol.for(key.sym);
  }
  return key.v;
}

const REFRESHER = new class Refresher extends Set {
  constructor() {
    super();
    setInterval(() => {
      this.forEach(v => v[REFRESH]());
    }, EXPIRE * 1000);
  }
}();

// XXX locks?

class DistributedMap extends ObservableMap {
  constructor(key, unserializeValue) {
    super();
    this[PID] = THIS_PID;
    this[KEY] = `map:${key}`;
    this[UNSERIALIZE] = unserializeValue;
    this[QUEUED] = [];
    this.onsync = this.onsync.bind(this);
    BROKER.on(this[KEY], this.onsync);
    this[LOADING] = (async() => {
      const data = await redis.hgetall(this[KEY]);
      super.clear();
      if (data) {
        for (const [sk, sv] of Object.entries(data)) {
          try {
            const k = unserializeKey(JSON.parse(sk));
            const v = unserializeValue ?
              unserializeValue(JSON.parse(sv)) :
              JSON.parse(sv);
            super.set(k, v);
          }
          catch (ex) {
            await redis.hdel(this[KEY], sk);
          }
        }
      }
      const queued = this[QUEUED];
      this[QUEUED] = null;
      queued.forEach(this.onsync);
    })();
  }

  get loaded() {
    return this[LOADING];
  }

  onsync(d) {
    if (d.pid === this[PID]) {
      return;
    }

    // Not fully loaded
    if (this[QUEUED]) {
      this[QUEUED].push(d);
      return;
    }

    switch (d.t) {
    case "s":
      if (this[UNSERIALIZE]) {
        d.v = this[UNSERIALIZE](d.v);
      }
      super.set(unserializeKey(d.k), d.v);
      return;

    case "d":
      super.delete(unserializeKey(d.k));
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
    if (this[QUEUED]) {
      throw new Error("Not fully loaded yet");
    }
    const [sk, sv] = [JSON.stringify(ensureKey(k)), JSON.stringify(v)];
    BROKER.PUB.dmap(this[KEY], this[PID], "set", sk, sv);
    super.set(k, v);
    return this;
  }

  delete(k) {
    if (this[QUEUED]) {
      throw new Error("Not fully loaded yet");
    }
    const sk = JSON.stringify(ensureKey(k));
    BROKER.PUB.dmap(this[KEY], this[PID], "delete", sk);
    return super.delete(k);
  }

  clear() {
    if (this[QUEUED]) {
      throw new Error("Not fully loaded yet");
    }
    BROKER.PUB.dmap(this[KEY], this[PID], "clear");
    super.clear();
  }

  kill() {
    BROKER.removeListener(this[KEY], this.onsync);
    super.clear();
  }
}

class DistributedSet extends ObservableSet {
  constructor(key) {
    super();
    this[KEY] = key;
    this[PID] = THIS_PID;
    this[QUEUED] = [];
    this.onsync = this.onsync.bind(this);
    BROKER.on(this[KEY], this.onsync);
    this[LOADING] = (async() => {
      const data = await redis.smembers(this[KEY]);
      super.clear();
      if (data) {
        for (const v of data) {
          try {
            super.add(unserializeKey(JSON.parse(v)));
          }
          catch (ex) {
            await redis.srem(this[KEY], v);
          }
        }
      }
      const queued = this[QUEUED];
      this[QUEUED] = null;
      queued.forEach(this.onsync);
    })();
  }

  get loaded() {
    return this[LOADING];
  }

  onsync(d) {
    if (d.pid === this[PID]) {
      return;
    }

    // Not fully loaded
    if (this[QUEUED]) {
      this[QUEUED].push(d);
      return;
    }

    switch (d.t) {
    case "a":
      super.add(unserializeKey(d.v));
      return;

    case "d":
      super.delete(unserializeKey(d.v));
      return;

    case "c":
      super.clear();
      return;

    default:
      console.error("invalid op", this[KEY], d);
      return;
    }
  }

  add(item) {
    if (this[QUEUED]) {
      throw new Error("Not fully loaded yet");
    }
    const sk = JSON.stringify(ensureKey(item));
    BROKER.PUB.dset(this[KEY], this[PID], "add", sk);
    super.add(item);
    return this;
  }

  delete(item) {
    if (this[QUEUED]) {
      throw new Error("Not fully loaded yet");
    }
    const sk = JSON.stringify(ensureKey(item));
    BROKER.PUB.dset(this[KEY], this[PID], "delete", sk);
    return super.delete(item);
  }

  clear() {
    if (this[QUEUED]) {
      throw new Error("Not fully loaded yet");
    }
    BROKER.PUB.dset(this[KEY], this[PID], "clear");
    super.clear();
  }

  kill() {
    this.emit("kill");
    this.removeAllListeners();
    BROKER.removeKeyListener(this[KEY], this.onsync);
    super.clear();
  }
}

class DistributedTracking extends EventEmitter {
  constructor(key) {
    // The tracked data can be out of sync, only eventual consistency is
    // guaranteed
    super();
    this[KEY] = `tracking:${key}`;
    this[PID] = THIS_PID;
    this[MAP] = new Map();
    this.onsync = this.onsync.bind(this);
    BROKER.on(this[KEY], this.onsync);
    this[LOADING] = (async () => {
      try {
        const data = JSON.parse(
          await redis.tracking(this[KEY], "getall", this[PID]));
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
    Object.seal(this);

    REFRESHER.add(this);
  }

  get loaded() {
    return this[LOADING];
  }

  [REFRESH]() {
    redis.tracking(this[KEY], "refresh", this[PID]);
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
    return await redis.tracking(this[KEY], "incr", this[PID], key);
  }

  async decr(key) {
    return await redis.tracking(this[KEY], "decr", this[PID], key);
  }

  async delete(key) {
    await redis.tracking(this[KEY], "del", this[PID], key);
    return this[MAP].delete(key);
  }

  async clear() {
    await redis.tracking(this[KEY], "clear", this[PID]);
    this[MAP].clear();
  }

  dump() {
    console.log(this[MAP]);
  }

  kill() {
    this.emit("kill");
    this.removeAllListeners();
    REFRESHER.delete(this);
    BROKER.removeListener(this[KEY], this.onsync);
    this[MAP].clear();
  }
}

class RemoteMap {
  constructor(key) {
    this[KEY] = key;
  }

  async has(key) {
    return await redis.hexists(this[KEY], key) === 1;
  }

  async get(key) {
    let rv = await redis.hget(this[KEY], key);
    if (rv) {
      rv = JSON.parse(rv);
    }
    return rv;
  }

  async set(key, val) {
    await redis.hset(this[KEY], key, JSON.stringify(val));
    return this;
  }

  async delete(key) {
    return await redis.hdel(this[KEY], key) === 1;
  }

  async clear() {
    await redis.del(this[KEY]);
  }
}

class RemoteSet {
  constructor(key) {
    this[KEY] = key;
  }

  async has(key) {
    return await redis.sismember(this[KEY], key) === 1;
  }

  async add(key) {
    await redis.sadd(this[KEY], key);
    return this;
  }

  async delete(key) {
    return await redis.srem(this[KEY], key) === 1;
  }

  async clear() {
    await redis.del(this[KEY]);
  }
}

module.exports = {
  DistributedMap,
  DistributedSet,
  DistributedTracking,
  RemoteMap,
  RemoteSet,
};
