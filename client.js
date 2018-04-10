"use strict";

const {toMessage} = require("./util");
const BROKER = require("./broker");
const {Room} = require("./room");

let running = 0;

class Client {
  constructor(socket) {
    const {nick, roomid} = socket.handshake.query;

    this.nick = null;
    this.onnick(nick);
    this.nick = this.nick || `anon-${++running}`;

    this.onusercount = this.onusercount.bind(this);
    this.onbrokermessage = this.onbrokermessage.bind(this);
    this.emit = socket.emit.bind(socket);

    this.roomid = roomid;
    this.socket = socket;
    this.room = Room.get(this.roomid);
    this.room.on("usercount", this.onusercount);
    this.room.ref();

    socket.on("message", this.onmessage.bind(this));
    socket.on("nick", this.onnick.bind(this));
    socket.on("disconnect", this.onclose.bind(this));

    BROKER.on("message", this.onbrokermessage);
    BROKER.on(`${this.roomid}:message`, this.onbrokermessage);

    Object.seal(this);

    this.emit("nick", this.nick);
    this.emit("usercount", this.room.userCount.value);
  }

  onmessage(msg) {
    msg = toMessage(msg);
    console.log(msg);
    BROKER.emit(`${this.roomid}:message`, {
      user: this.nick,
      msg
    });
  }

  onusercount(count) {
    this.emit("usercount", count);
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

  onbrokermessage(...m) {
    this.emit("message", ...m);
  }

  onclose() {
    BROKER.removeListener("message", this.onbrokermessage);
    BROKER.removeListener(`${this.roomid}:message`, this.onbrokermessage);
    this.socket.removeAllListeners();
    this.room.removeListener("usercount", this.onusercount);
    this.room.unref();
  }

  static create(socket) {
    return new Client(socket);
  }
}

module.exports = {Client};
