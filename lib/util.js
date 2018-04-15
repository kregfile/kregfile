"use strict";

const {URL} = require("url");
const {promisify} = require("util");
const crypto = require("crypto");
const config = require("./config");

const WHITE_REGEX = /^[\r\n]+$/;
const SCHEME_REGEX = /^(?:https?|ftp|irc):/;
const URL_REGEX = new RegExp(`([\r\n]+|#[a-z0-9_-]+|${require("url-regex")().source})`, "ig");

const TOKEN_SECRET = config.get("secret") + Date.now().toString();

const randomFill = promisify(crypto.randomFill);

function normalizeURL(url) {
  if (!url.match(SCHEME_REGEX)) {
    url = `https://${url}`;
  }
  url = new URL(url, "https://reddit.com/");
  url.username = url.password = "";
  return url.toString();
}


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


function toMessage(msg) {
  msg = msg.trim();
  if (msg.length > 300) {
    throw new Error("Message too long");
  }
  msg = msg.split(URL_REGEX).map((v, i) => {
    if (!(i % 2)) {
      return {t: "t", v};
    }
    try {
      if (v.startsWith("#")) {
        return {t: "r", v: v.slice(1)};
      }
      if (WHITE_REGEX.test(v)) {
        return {t: "b"};
      }
      return {t: "u", v: normalizeURL(v)};
    }
    catch (ex) {
      console.error(ex);
    }
    return {t: "t", v};
  });
  return msg;
}

module.exports = {
  normalizeURL,
  token,
  toMessage,
};
Object.assign(module.exports, require("./common"));
