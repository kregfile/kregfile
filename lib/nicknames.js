"use strict";

const {shuffle} = require("./util");

const pool = require.main.require("./names.json");
const defaults = new Set(pool.map(e => e.toUpperCase()));
let currentPool = [];

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

function random() {
  if (!currentPool.length) {
    currentPool = pool.slice();
    shuffle(currentPool);
  }
  return currentPool.pop();
}

function isDefault(nick) {
  return defaults.has(nick.toUpperCase()) || BLACKED_ACCOUNTS.test(nick);
}

function sanitize(nick, user) {
  nick = nick.toString().replace(/[^a-z\d]/gi, "");
  if (nick.length <= 3 || nick.length > 20) {
    return null;
  }
  if (user && user.account !== nick.toLowerCase()) {
    return user.name;
  }
  return nick;
}

module.exports = {
  random,
  isDefault,
  sanitize
};
