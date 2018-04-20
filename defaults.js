"use strict";

const {HTTP_PORT: port = 8080} = process.env;

const linux = require("os").platform() === "linux";

// Do not edit here.
// Overwrite with a .config.json or config.js (module)

module.exports = {
  // redis_* = options for redis
  // Listen port
  port,
  // For crypto shit, probably wanna customize it, or not, not that important
  secret: "kregfile",
  // Path to upload directory
  uploads: "uploads",
  // Number of hours a finished download takes to expire
  TTL: 48,
  // Number of hours an interrupted pending donwload may be resumed before
  // garbage collected
  pendingTTL: 12,
  // Use firejail when calling potential dangerous external commands,
  // see jail.profile
  jail: linux,
  // For meta data and asset generation, path to ffmpeg exiftool
  exiftool: "exiftool",
  // For asset generation, path to ffmpeg binary
  ffmpeg: "ffmpeg",
  // Number of messages before considered flooding
  chatFloodTrigger: 5,
  // Number of ms to block messages from flooding user
  chatFloodDuration: 10000,
  // Number of uploads before considered flooding
  uploadFloodTrigger: 25,
  // Number of ms to block uploads from flooding user
  uploadFloodDuration: 60000,
  // Max number of concurrent asset generators
  maxAssetsProcesses: 2,
  // Max number of concurrent metadata extractor processes
  maxMetaProcesses: 5,
  // For testing mostly, delay serving of assets and downloads
  delayServe: 0,
};
