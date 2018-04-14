"use strict";

const {URL} = require("url");

const WHITE_REGEX = /^[\r\n]+$/;
const SCHEME_REGEX = /^(?:https?|ftp|irc):/;
const URL_REGEX = new RegExp(`([\r\n]+|#[a-z0-9_-]+|${require("url-regex")().source})`, "ig");

function normalizeURL(url) {
  if (!url.match(SCHEME_REGEX)) {
    url = `https://${url}`;
  }
  url = new URL(url, "https://reddit.com/");
  url.username = url.password = "";
  return url.toString();
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
  toMessage,
};
Object.assign(module.exports, require("./common"));
