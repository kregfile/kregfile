"use strict";

const {HTTP_PORT: port = 8080} = process.env;

const linux = require("os").platform() === "linux";

module.exports = {
  port,
  secret: "kregfile",
  uploads: "uploads",
  TTL: 48,
  pendingTTL: 12,
  jail: linux,
  exiftool: "exiftool",
  ffmpeg: "ffmpeg",
  chatFloodTrigger: 5,
  chatFloodDuration: 10000,
  uploadFloodTrigger: 25,
  uploadFloodDuration: 60000,
  maxAssetsProcesses: 2,
  maxMetaProcesses: 5,
  delayServe: 0,
};
