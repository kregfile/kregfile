"use strict";

const {token, toMessage, parseCommand} = require("./util");
const BROKER = require("./broker");
const {Room} = require("./room");
const tracking = require("./tracking");
const clientversion = require("./clientversion");
const {registerUploadKey, queryOffset} = require("./upload");

let running = 0;

class Client {
  constructor(socket) {
    const {remoteAddress, remotePort} = socket.request.connection;
    this.ip = remoteAddress;
    this.port = remotePort;
    this.address = `${this.ip}:${this.port}`;

    const {nick, roomid, cv} = socket.handshake.query;
    this.nick = null;
    this.onnick(nick);
    this.nick = this.nick || `anon-${++running}`;

    this.onusercount = this.onusercount.bind(this);
    this.onconfig = this.onconfig.bind(this);
    this.onfiles = this.onfiles.bind(this);
    this.unicast = this.unicast.bind(this);
    this.emit = socket.emit.bind(socket);

    this.roomid = roomid;
    this.socket = socket;
    this.room = Room.get(this.roomid);

    const {FloodProtector} = tracking;
    this.chatFlooding = new FloodProtector(
      this.ip, tracking.floods, 5, 10000);
    this.uploadFlooding = new FloodProtector(
      this.ip, tracking.uploadFloods, 2, 60000);

    Object.seal(this);

    socket.on("message", this.onmessage.bind(this));
    socket.on("nick", this.onnick.bind(this));
    socket.on("disconnect", this.onclose.bind(this));
    socket.on("uploadkey", this.onuploadkey.bind(this));
    socket.on("queryoffset", this.onqueryoffset.bind(this));

    BROKER.on("message", this.unicast);
    BROKER.on(`${this.roomid}:message`, this.unicast);

    this.room.on("usercount", this.onusercount);
    this.room.on("config", this.onconfig);
    this.room.on("files", this.onfiles);

    this.room.ref(this.ip).then(async () => {
      this.emit("config", Array.from(this.room.config));
      const files = await this.room.getFilesFor(this);
      this.emit("files", {replace: true, files});
    });
    tracking.clients.incr(this.ip);

    console.log(`Client at ${this.address.bold} connected`);

    this.emit("time", Date.now());
    this.emit("nick", this.nick);
    if (cv !== clientversion) {
      this.emit("outdated");
    }
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
      if (await this.chatFlooding.flooding()) {
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

  onusercount(count) {
    this.emit("usercount", count);
  }

  onconfig(key, value) {
    this.emit("config", [[key, value]]);
  }

  onfiles(action, files) {
    switch (action) {
    case "add":
      files = this.room.convertFiles(files, this);
      if (!files.length) {
        return;
      }
      this.emit("files", {files});
      return;

    case "delete":
      files = files.map(f => f.key);
      if (!files.length) {
        return;
      }
      this.emit("files-deleted", {files});
      return;
    }
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
    console.log(`Client at ${this.address.bold} disconnected`);
  }

  async onuploadkey() {
    try {
      const floodEnd = await this.uploadFlooding.flooding();
      if (floodEnd) {
        this.emit("uploadkey", {wait: floodEnd});
        return;
      }
      const key = await token();
      await registerUploadKey(this.roomid, this.nick, key);
      this.emit("uploadkey", key);
    }
    catch (ex) {
      this.emit("uploadkey", {err: ex.message || ex.toMessage()});
    }
  }

  async onqueryoffset(key) {
    try {
      const offset = await queryOffset(key);
      this.emit(`queryoffset-${key}`, offset);
    }
    catch (ex) {
      this.emit(`queryoffset-${key}`, {err: ex.message || ex.toMessage()});
    }
  }

  static create(socket) {
    return new Client(socket);
  }
}

module.exports = {Client};
