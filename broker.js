"use strict";

const EventEmitter = require("events");
const {createClient: redis} = require("redis");

const PUB = redis();

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
      console.log("unsubed", event);
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
