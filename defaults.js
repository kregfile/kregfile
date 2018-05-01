"use strict";

const {HTTP_PORT: port = 8080} = process.env;
const {HTTPS_PORT: tlsport = 8443} = process.env;

const linux = require("os").platform() === "linux";

// Do not edit here.
// Overwrite with a .config.json or config.js (module)

module.exports = {
  // Your site's name
  name: "kregfile",

  // redis_* = options for redis
  // Listen port
  port,

  // run tls server
  tls: false,
  tlsonly: false,
  tlskey: "",
  tlscert: "",
  tlsport,

  // For crypto shit, probably wanna customize it, or not, not that important
  secret: "kregfile",

  // Path to upload directory
  uploads: "uploads",

  // Number of hours a finished download takes to expire
  TTL: 48,

  // Number of hours an interrupted pending donwload may be resumed before
  // garbage collected
  pendingTTL: 12,

  // Session TTL for logged in users, in seconds
  sessionTTL: 2592000,

  // Number of messages before considered flooding
  chatFloodTrigger: 5,
  // Number of ms to block messages from flooding user
  chatFloodDuration: 10000,

  // Number of uploads before considered flooding
  uploadFloodTrigger: 25,
  // Number of ms to block uploads from flooding user
  uploadFloodDuration: 60000,

  // Number of login attempts before considered flooding
  loginFloodTrigger: 5,
  // Number of ms to block login attempts from flooding user
  loginFloodDuration: 900000,

  // Number of created account before considered flooding
  accountFloodTrigger: 3,
  // Number of ms to block login attempts from flooding user
  accountFloodDuration: 21600000,

  // Number of created rooms before considered flooding
  roomFloodTrigger: 10,
  // Number of ms to block new rooms from flooding user
  roomFloodDuration: 60 * 60 * 1000,

  // Use firejail when calling potential dangerous external commands,
  // see jail.profile
  jail: linux,
  // For meta data and asset generation, path to ffmpeg exiftool
  exiftool: "exiftool",
  // For asset generation, path to ffmpeg binary
  ffmpeg: "ffmpeg",
  // Max number of concurrent asset generators
  maxAssetsProcesses: 2,
  // Max number of concurrent metadata extractor processes
  maxMetaProcesses: 5,

  // For testing mostly, delay serving of assets and downloads
  delayServe: 0,
  // For testing mostly, always create a new storage
  // (leaking old ones, potentially)
  forceNewStorage: false,
};
