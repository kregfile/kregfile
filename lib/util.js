"use strict";

const {URL} = require("url");
const {promisify} = require("util");
const crypto = require("crypto");
const config = require("./config");
const message = require("../common/message");

const FILE_OFILTER = new Set(
  ["key", "name", "type", "href"]);

const TOKEN_SECRET = config.get("secret") + Date.now().toString();

const randomFill = promisify(crypto.randomFill);

async function token(len) {
  let buf = Buffer.alloc(20);
  await randomFill(buf, 0, 16);
  buf.writeUInt32BE((Date.now() / 1000) | 0, 16);
  buf = crypto.createHmac("sha256", TOKEN_SECRET).update(buf).digest("base64");
  if (len) {
    buf = buf.slice(0, len);
  }
  return buf.replace(/=/g, "").replace(/\//g, "_").replace(/\+/g, "-");
}

async function resolveRoom(v) {
  const {Room} = require("./room");

  try {
    const room = await Room.get(v);
    if (!room) {
      return null;
    }
    return {
      v,
      n: room.config.get("roomname") || v
    };
  }
  catch (ex) {
    return null;
  }
}

function resolveFile(v) {
  const u = require("./upload").resolve(v);

  if (!u) {
    return null;
  }
  return module.exports.ofilter(u, FILE_OFILTER);
}

module.exports = {
  normalizeURL: message.normalizeURL.bind(null, URL),
  toMessage: message.toMessage.bind(null, URL, resolveRoom, resolveFile),
  token,
};

Object.assign(module.exports, require("../common"));
