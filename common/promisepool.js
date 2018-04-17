"use strict";

class PromisePool {
  constructor(limit) {
    this._limit = Math.max(limit || 5, 1);
    this._items = [];
    this._running = 0;
    this._next = this.next.bind(this);
    Object.seal(this);
  }
  get limit() {
    return this._limit;
  }
  get running() {
    return this._running;
  }
  get scheduled() {
    return this._items.length;
  }
  get total() {
    return this.scheduled + this.running;
  }
  static wrapNew(limit, ctx, fn) {
    return new PromisePool(limit).wrap(ctx, fn);
  }
  wrap(ctx, fn) {
    return this.scheduleWithContext.bind(this, ctx, fn);
  }
  schedule(fn, ...args) {
    return this.scheduleWithContext(null, fn, ...args);
  }
  scheduleWithContext(ctx, fn, ...args) {
    if (this._running < this.limit) {
      try {
        const p = Promise.resolve(fn.call(ctx, ...args));
        this._running++;
        p.finally(this._next).ignore();
        return p;
      }
      catch (ex) {
        return Promise.reject(ex);
      }
    }
    const item = { ctx, fn, args };
    const rv = new Promise((res, rej) => {
      item.res = res;
      item.rej = rej;
    });
    this._items.push(item);
    return rv;
  }
  next() {
    this._running--;
    const item = this._items.shift();
    if (!item) {
      return;
    }
    try {
      const p = Promise.resolve(item.fn.call(item.ctx, ...item.args));
      this._running++;
      item.res(p);
      p.finally(this._next).ignore();
    }
    catch (ex) {
      try {
        item.rej(ex);
      }
      finally {
        this.next();
      }
    }
  }
}

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  if (typeof require === "function") {
    require("./finally");
  }
  module.exports = {
    PromisePool
  };
}
