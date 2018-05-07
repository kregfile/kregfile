"use strict";

const msgpack = require("notepack.io");
const parser = require("socket.io-parser");

/**
 * Packet types (see https://github.com/socketio/socket.io-protocol)
 */

exports.CONNECT = 0;
exports.DISCONNECT = 1;
exports.EVENT = 2;
exports.ACK = 3;
exports.ERROR = 4;
exports.BINARY_EVENT = 5;
exports.BINARY_ACK = 6;

let forceJSON = false;

if (typeof window === "undefined") {
  forceJSON = process.env.NODE_ENV !== "production";
}

const errorPacket = {
  type: exports.ERROR,
  data: "parser error"
};

class Encoder extends parser.Encoder {
  constructor(...args) {
    super(...args);
    this.seq = 0;
  }

  encode(packet, callback) {
    if (packet.data) {
      packet.data.push(this.seq++);
    }
    else {
      packet.data = [this.seq++];
    }
    //packet.s = this.seq++;
    switch (packet.type) {
    case exports.CONNECT:
      packet.data.push(forceJSON);
      // fallthrough

    case exports.DISCONNECT:
      // fallthrough

    case exports.ERROR:
      return super.encode(packet, callback);

    default:
      if (forceJSON) {
        return super.encode(packet, callback);
      }
      return this.encodeMsgPack(packet, callback);
    }
  }

  encodeMsgPack(packet, callback) {
    const o = Object.assign({
      d: packet.data,
    }, packet);
    if (o.nsp === "/") {
      delete o.nsp;
    }
    if (typeof o.d === "undefined") {
      delete o.d;
    }
    return callback([msgpack.encode(o)]);
  }
}

class Decoder extends parser.Decoder {
  constructor(...args) {
    super(...args);
    this.seq = 0;
  }

  add(obj) {
    if (typeof obj !== "string") {
      this.addMsgPack(obj);
      return;
    }
    super.add(obj);
  }

  emit(ev, data) {
    if (ev === "decoded") {
      if (data.type === exports.CONNECT) {
        forceJSON = data.data.pop();
      }
      this.seq = data.data.pop();
    }
    super.emit(ev, data);
  }

  addMsgPack(obj) {
    try {
      const decoded = msgpack.decode(obj);
      if (!decoded.nsp) {
        decoded.nsp = "/";
      }
      if ("d" in decoded) {
        decoded.data = decoded.d;
        delete decoded.d;
      }
      this.emit("decoded", decoded);
    }
    catch (e) {
      this.emit("decoded", errorPacket);
    }
  }
}

exports.Encoder = Encoder;
exports.Decoder = Decoder;
