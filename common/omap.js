"use strict";

const EventEmitter = require("events");
const {mixin} = require("./");

class ObservableMap extends Map {
  constructor(...args) {
    super(...args);
    mixin(this, new EventEmitter());
  }

  set(k, v) {
    const exists = super.has(k);
    super.set(k, v);
    if (!exists) {
      this.emit("set", k, v);
      this.emit(`set-${k}`, v);
    }
    else {
      this.emit("update", k, v);
      this.emit(`update-${k}`, v);
    }
    this.emit("change", k, v);
    this.emit(`change-${k}`, v);
    return this;
  }

  delete(k) {
    this.emit("predelete", k);
    this.emit(`predelete-${k}`);
    const rv = super.delete(k);
    if (rv) {
      this.emit("delete", k, rv);
      this.emit(`delete-${k}`, rv);
    }
    return rv;
  }

  clear() {
    super.clear();
    this.emit("clear");
  }

  kill() {
    this.removeAllListeners();
    super.clear();
  }
}

module.exports = { ObservableMap };
