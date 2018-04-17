"use strict";

const EventEmitter = require("events");
const {mixin} = require("./");

class ObservableSet extends Set {
  constructor(...args) {
    super(...args);
    mixin(this, new EventEmitter());
  }

  add(item) {
    if (super.has(item)) {
      return this;
    }
    super.add(item);
    this.emit("add", item);
    return this;
  }

  delete(item) {
    const rv = super.delete(item);
    if (rv) {
      this.emit("delete", item);
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

module.exports = { ObservableSet };
