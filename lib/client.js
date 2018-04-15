"use strict";

const {toMessage, parseCommand} = require("./util");
const BROKER = require("./broker");
const {Room} = require("./room");
const tracking = require("./tracking");

let running = 0;

class Client {
  constructor(socket) {
    const {remoteAddress, remotePort} = socket.request.connection;
    this.ip = remoteAddress;
    this.port = remotePort;
    this.address = `${this.ip}:${this.port}`;

    const {nick, roomid} = socket.handshake.query;
    this.nick = null;
    this.onnick(nick);
    this.nick = this.nick || `anon-${++running}`;

    this.onusercount = this.onusercount.bind(this);
    this.onconfig = this.onconfig.bind(this);
    this.unicast = this.unicast.bind(this);
    this.emit = socket.emit.bind(socket);

    this.roomid = roomid;
    this.socket = socket;
    this.room = Room.get(this.roomid);

    Object.seal(this);

    socket.on("message", this.onmessage.bind(this));
    socket.on("nick", this.onnick.bind(this));
    socket.on("disconnect", this.onclose.bind(this));

    BROKER.on("message", this.unicast);
    BROKER.on(`${this.roomid}:message`, this.unicast);

    this.room.on("usercount", this.onusercount);
    this.room.on("config", this.onconfig);

    this.room.ref(this.ip).then(() => {
      this.emit("config", Array.from(this.room.config));
    });
    tracking.clients.incr(this.ip);

    console.log(`Client at ${this.address.bold} connected`);
    this.emit("nick", this.nick);
  }

  broadcast(msg) {
    BROKER.emit(`${this.roomid}:message`, msg);
  }

  unicast(...args) {
    this.emit("message", ...args);
  }

  async onmessage(msg) {
    msg = msg.trim();
    try {
      const cmd = parseCommand(msg);
      if (cmd) {
        try {
          msg = await this.room.doCommand(this, cmd);
          if (msg) {
            this.unicast({
              user: "Command",
              role: "system",
              volatile: true,
              msg: toMessage(msg)
            });
          }
        }
        catch (ex) {
          console.error(ex);
          this.unicast({
            user: "Error",
            role: "system",
            volatile: true,
            msg: toMessage(ex.message || ex.toString())
          });
        }
        return;
      }
      if (msg[0] === "/") {
        msg = msg.slice(1);
      }
      if (await this.isFlooding()) {
        this.unicast({
          volatile: true,
          user: "System",
          role: "system",
          msg: toMessage("You're posting too fast")
        });
        return;
      }
      this.broadcast({
        user: this.nick,
        msg: toMessage(msg),
      });
    }
    catch (ex) {
      this.unicast({
        volatile: true,
        user: "System",
        role: "system",
        msg: toMessage(ex.message || ex.toString())
      });
    }
  }

  async isFlooding() {
    let cur = tracking.floods.get(this.ip);
    if (cur > 5) {
      return true;
    }
    cur = await tracking.floods.incr(this.ip);
    if (cur === 1) {
      setTimeout(() => tracking.floods.delete(this.ip), 10000);
    }
    if (cur <= 5) {
      return false;
    }
    return true;
  }


  onusercount(count) {
    this.emit("usercount", count);
  }

  onconfig(key, value) {
    this.emit("config", [[key, value]]);
  }

  onnick(nick) {
    if (!nick) {
      return;
    }
    nick = nick.toString().replace(/[^a-z\d]/gi, "");
    if (nick.length <= 3 || nick.length > 20) {
      return;
    }
    this.nick = nick;
  }

  onclose() {
    tracking.clients.decr(this.ip);
    BROKER.removeListener("message", this.unicast);
    BROKER.removeListener(`${this.roomid}:message`, this.unicast);

    this.socket.removeAllListeners();

    this.room.removeListener("usercount", this.onusercount);
    this.room.removeListener("config", this.onconfig);
    this.room.unref(this.ip);
  }

  static create(socket) {
    return new Client(socket);
  }
}

module.exports = {Client};
