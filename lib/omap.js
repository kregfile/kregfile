"use strict";

const EventEmitter = require("events");
const {mixin} = require("./common");

class ObservableMap extends Map {
  constructor(...args) {
    super(...args);
    mixin(this, new EventEmitter());
  }

  set(k, v) {
    const rv = super.set(k, v);
    this.emit("set", k, v);
    this.emit(`set-${k}`, v);
    return rv;
  }

  delete(k) {
    const rv = super.delete(k);
    this.emit("delete", k, rv);
    this.emit(`delete-${k}`, rv);
    return rv;
  }

  clear() {
    const rv = super.clear();
    this.emit("clear");
    return rv;
  }

  kill() {
    this.removeAllListeners();
    super.clear();
  }
}

module.exports = { ObservableMap };
