"use strict";

const {HTTP_PORT: port = 8080} = process.env;

const linux = require("os").platform === "linux";

module.exports = {
  port,
  secret: "kregfile",
  uploads: "uploads",
  TTL: 48,
  pendingTTL: 12,
  jail: linux,
  exiftool: "exiftool",
};
