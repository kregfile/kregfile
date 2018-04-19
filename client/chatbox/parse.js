"use strict";

const FILES = new URL("/g/", document.location).toString();
const ROOMS = new URL("/r/", document.location).toString();
const KEY = /^[a-z0-9_-]+/gi;

export const WHITE = /[\s\r\n]/;

function convertMessagePart(m) {
  if (m.startsWith(FILES)) {
    const key = m.slice(FILES.length).match(KEY);
    if (key) {
      return `@${key[0]}`;
    }
  }
  if (m.startsWith(ROOMS)) {
    const key = m.slice(ROOMS.length).match(KEY);
    if (key) {
      return `#${key[0]}`;
    }
  }
  return m;
}

function *tokenizeMessage(m) {
  let cur = "";
  for (const c of m) {
    if (WHITE.test(c)) {
      if (cur) {
        yield convertMessagePart(cur) + c;
        cur = "";
      }
      else {
        yield c;
      }
      continue;
    }
    cur += c;
  }
  if (cur) {
    cur = convertMessagePart(cur);
    yield cur;
  }
}

export function convertMessage(m) {
  return Array.from(tokenizeMessage(m)).join("");
}
