"use strict";

const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {createClient: redis} = require("redis");

const PUB = redis();

(function() {
const dir = path.join(path.dirname(require.main.filename), "redis");
for (const file of fs.readdirSync(dir).map(e => path.join(dir, e))) {
  const p = path.parse(file);
  if (p.ext !== ".lua") {
    continue;
  }
  let {name} = p;
  name = name.match(/^([a-z]+)-(\d+)$/);
  if (!name) {
    throw new Error("bad script name");
  }
  const arity = parseInt(name[2], 10);
  if (!isFinite(arity) || arity < 0) {
    throw new Error("bad script arity");
  }
  [, name] = name;
  const src = fs.readFileSync(file, {encoding: "utf-8"});
  if (!src) {
    throw new Error("bad source");
  }
  const sum = crypto.createHash("sha1").update(src).digest("hex");
  PUB.script("load", src, (err, data) => {
    if (err) {
      throw new Error(err);
    }
    if (data !== sum) {
      throw new Error("broken checksum");
    }
  });
  Object.defineProperty(PUB, name, {
    value(...args) {
      if (args.length < arity + 1) {
        throw new Error("not enough args");
      }
      PUB.evalsha(sum, arity, ...args);
    },
    enumerable: true
  });
}
})();


class Broker extends EventEmitter {
  constructor(conn) {
    super();

    const sub = redis(conn);
    const subs = new Map();

    sub.on("message", (channel, message) => {
      message = JSON.parse(message);
      super.emit(channel, ...message);
    });

    this.on("newListener", event => {
      if (event === "newListener" || event === "removeListener") {
        return;
      }
      let count = subs.get(event) || 0;
      if (count) {
        subs.set(event, ++count);
        return;
      }
      subs.set(event, 1);
      sub.subscribe(event);
    });

    this.on("removeListener", event => {
      let count = (subs.get(event) || 0);
      --count;
      if (count > 0) {
        subs.set(event, count);
        return;
      }
      subs.delete(event);
      sub.unsubscribe(event);
    });
  }

  emit(event, ...args) {
    if (event === "newListener" || event === "removeListener") {
      return super.emit(event, ...args);
    }
    args = JSON.stringify(args);
    return PUB.publish(event, args);
  }
}

const BROKER = new Broker();
BROKER.PUB = PUB;
module.exports = BROKER;
