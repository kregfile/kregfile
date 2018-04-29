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
  let buf = Buffer.alloc(8);
  await randomFill(buf, 0, 4);
  buf.writeUInt32BE(buf, 4, (Date.now() / 1000) | 0);
  buf = crypto.createHmac("sha1", TOKEN_SECRET).update(buf).digest("base64");
  if (len) {
    buf = buf.slice(0, len);
  }
  return buf.replace(/=/g, "").replace(/\//g, "_").replace(/\+/g, "-");
}

function resolveRoom(v) {
  return {v};
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
