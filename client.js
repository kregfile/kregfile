"use strict";

const {toMessage} = require("./util");
const BROKER = require("./broker");

let running = 0;

class Client {
  constructor(socket) {
    const {nick, roomid} = socket.handshake.query;

    this.nick = null;
    this.onnick(nick);
    this.nick = this.nick || `anon-${++running}`;

    this.roomid = roomid;
    this.socket = socket;
    socket.on("message", this.onmessage.bind(this));
    socket.on("nick", this.onnick.bind(this));
    socket.on("disconnect", this.onclose.bind(this));

    this.onbrokermessage = this.onbrokermessage.bind(this);
    BROKER.on("message", this.onbrokermessage);
    BROKER.on(`${this.roomid}:message`, this.onbrokermessage);
    this.emit = socket.emit.bind(socket);
    this.emit("nick", this.nick);
    Object.seal(this);
  }

  onmessage(msg) {
    msg = toMessage(msg);
    console.log(msg);
    BROKER.emit(`${this.roomid}:message`, {
      user: this.nick,
      msg
    });
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
    this.socket.emit("message", ...m);
  }

  onclose() {
    BROKER.removeListener("message", this.onbrokermessage);
    BROKER.removeListener(`${this.roomid}:message`, this.onbrokermessage);
    this.socket.removeAllListeners();
  }

  static create(socket) {
    return new Client(socket);
  }
}

module.exports = {Client};
