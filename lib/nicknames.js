"use strict";

const XRegExp = require("xregexp");
const {shuffle} = require("./util");

const defaults = new Set(require.main.require("./names.json").
  map(e => e.toUpperCase()));

const BLACKED_ACCOUNTS = new RegExp([
  "REALDOLOS",
  "REAIDOLOS",
  "REALDOIOS",
  "REAIDOIOS",
  "ADMIN",
  "MODERATOR",
  "STAFF",
  "MOTD",
  "SYSTEM",
].join("|"), "i");

function *pool(names) {
  let cur = [];
  for (;;) {
    if (!cur.length) {
      cur = names.slice();
      shuffle(cur);
    }
    yield cur.pop();
  }
}

const random = (function *random() {
yield *pool(require.main.require("./names.json"));
})();

const randomRN = (function *randomRN() {
const {adj, names} = require.main.require("./roomnames.json");
const a = pool(adj);
const n = pool(names);
for (;;) {
  yield `${a.next().value} ${n.next().value}`;
}
})();

function isDefault(nick) {
  return defaults.has(nick.toUpperCase()) || BLACKED_ACCOUNTS.test(nick);
}

function sanitize(nick, user) {
  nick = nick.toString().replace(new XRegExp("[^\\p{Latin}\\d]", "gi"), "");
  if (nick.length < 3 || nick.length > 20) {
    return null;
  }
  if (user && user.account !== nick.toLowerCase()) {
    return user.name;
  }
  return nick;
}

module.exports = {
  random: () => random.next().value,
  randomRN: () => randomRN.next().value,
  isDefault,
  sanitize
};
