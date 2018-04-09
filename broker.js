"use strict";

const EventEmitter = require("events");
const {createClient: redis} = require("redis");

class Broker extends EventEmitter {
  constructor(conn) {
    super();

    this.pub = redis(conn);
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
    console.log(args);
    return this.pub.publish(event, args);
  }
}

module.exports = new Broker();
