"use strict";

const BROKER = require("./broker");
const {DistributedTracking} = require("./broker/collections");

const clients = new DistributedTracking("clients");

const redis = BROKER.getMethods("get", "del", "ratelimit");

const KEY = Symbol();

class FloodProtector {
  constructor(what, where, max, expires) {
    this.what = what;
    this.where = where;
    this.max = max;
    this.expires = expires;
    this[KEY] = `flooding:${this.where}:${this.what}`;
    Object.seal(this);
  }

  async check() {
    return parseInt(await redis.get(this[KEY]), 10) >= this.max;
  }

  async bump() {
    const [val, ttl] = await redis.ratelimit(this[KEY], this.expires);
    return val > this.max ? ttl : 0;
  }

  async delete() {
    await redis.del(this[KEY]);
  }
}

module.exports = {
  FloodProtector,
  clients,
};
