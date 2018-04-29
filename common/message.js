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

async function mapMessagePart(v, i, rec) {
  if (!(i % 2)) {
    return {t: "t", v};
  }
  try {
    if (v.startsWith("#")) {
      if (rec.rooms < 10) {
        let r = rec.resolveRoom(v.slice(1));
        if (r && r.then) {
          r = await r;
        }
        if (r) {
          rec.rooms++;
          return Object.assign({t: "r"}, r);
        }
      }
      return {t: "t", v};
    }
    if (v.startsWith("@")) {
      if (rec.files < 5) {
        let f = rec.resolveFile(v.slice(1));
        if (f && f.then) {
          f = await f;
        }
        if (f) {
          rec.files++;
          return Object.assign({t: "f"}, f);
        }
      }
      return {t: "t", v};
    }
    if (WHITE_REGEX.test(v)) {
      if (rec.breaks++ > 1) {
        return {t: "t", v: " "};
      }
      return {t: "b"};
    }
    return {t: "u", v: normalizeURL(rec.URL, v)};
  }
  catch (ex) {
    console.error(ex);
  }
  return {t: "t", v};
}

async function toMessage(URL, resolveRoom, resolveFile, msg) {
  msg = msg.trim();
  if (msg.length > 300) {
    throw new Error("Message too long");
  }

  const records = {
    breaks: 0,
    files: 0,
    rooms: 0,
    URL,
    resolveFile,
    resolveRoom,
  };
  let i = 0;
  const rv = [];
  for (const p of msg.split(URL_REGEX)) {
    rv.push(await mapMessagePart(p, i++, records));
  }
  return rv;
}

module.exports = {
  normalizeURL,
  toMessage,
};
