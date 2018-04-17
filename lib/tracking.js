"use strict";

const {DistributedTracking} = require("./broker/collections");


const clients = new DistributedTracking("clients");
const floods = new DistributedTracking("floods");
const uploadFloods = new DistributedTracking("ufloods");

class FloodProtector {
  constructor(what, where, max, when) {
    this.what = what;
    this.where = where;
    this.max = max;
    this.when = when;
    this.active = false;
    this.end = 0;
    Object.seal(this);
  }

  async flooding() {
    if (this.active) {
      return this.end;
    }
    let cur = this.where.get(this.what);
    if (cur > this.max) {
      // coming from another websocket, so estimate
      this.active = true;
      this.end = this.when + Date.now();
      setTimeout(() => {
        this.end = 0;
        this.active = false;
      }, this.when);
      return this.end;
    }
    cur = await this.where.incr(this.what);
    if (cur === 1) {
      this.end = this.when + Date.now();
      setTimeout(() => {
        this.where.delete(this.what);
        this.end = 0;
        this.active = false;
      }, this.when);
    }
    if (cur <= this.max) {
      return false;
    }
    this.active = true;
    return this.end;
  }
}


module.exports = {
  FloodProtector,
  clients,
  floods,
  uploadFloods,
};
