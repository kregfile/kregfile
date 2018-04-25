"use strict";

const SCHEME_REGEX = /^(?:https?|ftp|irc):/;
const WHITE_REGEX = /^[\r\n]+$/;
const URL_REGEX = new RegExp(`([\r\n]+|[#@][a-z0-9_-]+|${require("url-regex")().source})`, "ig");


function normalizeURL(URL, url) {
  if (!url.match(SCHEME_REGEX)) {
    url = `https://${url}`;
  }
  url = new URL(url, "https://reddit.com/");
  url.username = url.password = "";
  return url.toString();
}

function toMessage(URL, resolveRoom, resolveFile, msg) {
  msg = msg.trim();
  if (msg.length > 300) {
    throw new Error("Message too long");
  }
  let breaks = 0;
  msg = msg.split(URL_REGEX).map((v, i) => {
    if (!(i % 2)) {
      return {t: "t", v};
    }
    try {
      if (v.startsWith("#")) {
        const r = resolveRoom(v.slice(1));
        if (r) {
          return Object.assign({t: "r"}, r);
        }
        return {t: "t", v};
      }
      if (v.startsWith("@")) {
        const f = resolveFile(v.slice(1));
        if (f) {
          return Object.assign({t: "f"}, f);
        }
        return {t: "t", v};
      }
      if (WHITE_REGEX.test(v)) {
        if (breaks++ > 1) {
          return {t: "t", v: " "};
        }
        return {t: "b"};
      }
      return {t: "u", v: normalizeURL(URL, v)};
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
