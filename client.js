"use strict";

const {toMessage, parseCommand} = require("./util");
const BROKER = require("./broker");
const {Room} = require("./room");

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
    this.onconfigloaded = this.onconfigloaded.bind(this);
    this.unicast = this.unicast.bind(this);
    this.emit = socket.emit.bind(socket);

    this.roomid = roomid;
    this.socket = socket;
    this.room = Room.get(this.roomid);
    this.room.on("usercount", this.onusercount);
    this.room.on("config", this.onconfig);
    this.room.on("config-loaded", this.onconfigloaded);
    this.room.ref();

    socket.on("message", this.onmessage.bind(this));
    socket.on("nick", this.onnick.bind(this));
    socket.on("disconnect", this.onclose.bind(this));

    BROKER.on("message", this.unicast);
    BROKER.on(`${this.roomid}:message`, this.unicast);

    Object.seal(this);

    this.emit("nick", this.nick);
    this.emit("usercount", this.room.userCount.value);
  }

  broadcast(msg) {
    BROKER.emit(`${this.roomid}:message`, msg);
  }

  unicast(...args) {
    this.emit("message", ...args);
  }

  async onmessage(msg) {
    msg = msg.trim();
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
    this.broadcast({
      user: this.nick,
      msg: toMessage(msg),
    });
  }

  onusercount(count) {
    this.emit("usercount", count);
  }

  onconfig(key, value) {
    this.emit("config", [[key, value]]);
    if (key === "motd") {
      this.sendMOTD(value);
    }
  }

  onconfigloaded(config) {
    this.emit("config", config);
    this.sendMOTD();
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
    BROKER.removeListener("message", this.unicast);
    BROKER.removeListener(`${this.roomid}:message`, this.unicast);

    this.socket.removeAllListeners();

    this.room.removeListener("usercount", this.onusercount);
    this.room.removeListener("config", this.onconfig);
    this.room.removeListener("config-loaded", this.onconfigloaded);
    this.room.unref();
  }

  sendMOTD(motd) {
    motd = motd || this.room.config.get("motd");
    if (!motd) {
      return;
    }
    this.unicast({
      user: "MOTD",
      role: "system",
      volatile: true,
      msg: motd
    });
  }

  static create(socket) {
    return new Client(socket);
  }
}

module.exports = {Client};
