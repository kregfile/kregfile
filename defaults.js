"use strict";

const os = require("os");

const {HTTP_PORT: port = 8080} = process.env;
const {HTTPS_PORT: tlsport = 8443} = process.env;
const NUM_CPUS = os.cpus().length;

const LINUX = os.platform() === "linux";

// Do not edit here.
// Overwrite with a .config.json or config.js (module)

module.exports = {
  // Your site's name
  name: "kregfile",

  // Your site's motto
  motto: "Made with rice",

  // redis_* = options for redis

  /****************/
  /* Server stuff */
  /****************/

  // Listen port
  port,

  // how many web workers to run
  workers: Math.max(NUM_CPUS + 1, 2),

  // For crypto shit, probably wanna customize it, or not, not that important
  secret: "kregfile",

  // Path to upload directory
  uploads: "uploads",

  // Path to keep the moderation log
  modlog: "mod.log",

  // Allow X-Forwarded-For to set client IP if found
  considerProxyForwardedForHeaders: false,

  // Run tls server
  tls: false,
  tlsonly: false,
  // Path to the TLS key
  tlskey: "",
  // Path to the TLS cert
  tlscert: "",
  // Path to the tls port
  tlsport,

  /**********/
  /* Limits */
  /**********/

  // Default chat history size for this instance (kept in browser only)
  historySize: 500,

  // Require an account for chatting and uploads
  // implies roomCreationRequiresAccount if true
  requireAccounts: false,

  // Enable disable creating new rooms
  roomCreation: true,

  // Require registered accounts when creating rooms
  roomCreationRequiresAccount: false,

  // Number of hours a finished download takes to expire
  // Mods can override this per room
  TTL: 48,

  // Maximal file size in bytes.
  // Set to 0 to disable.
  maxFileSize: 10 * 1024 * 1024 * 1024,

  /*****************/
  /* Flood control */
  /*****************/

  // Number of messages before considered flooding
  chatFloodTrigger: 5,
  // Number of ms to block messages from flooding user
  chatFloodDuration: 10000,

  // Number of reports before considered flooding
  reportFloodTrigger: 1,
  // Number of ms to block reports from flooding user
  reportFloodDuration: 120000,

  // Number of uploads before considered flooding
  uploadFloodTrigger: 60,
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


  /************/
  /* Previews */
  /************/

  // Use firejail when calling potential dangerous external commands,
  // see jail.profile
  jail: LINUX,

  // For meta data and asset generation, path to ffmpeg exiftool
  exiftool: "exiftool",

  // For asset generation, path to ffmpeg binary
  ffmpeg: "ffmpeg",

  // For further checking the file type, if exiftool fails
  filetool: "file",

  // Max number of concurrent asset generators
  maxAssetsProcesses: 2,

  // Max number of concurrent metadata extractor processes
  maxMetaProcesses: 5,


  /***************/
  /* Fine tuning */
  /***************/

  // Number of hours an interrupted pending donwload may be resumed before
  // garbage collected
  pendingTTL: 12,

  // Session TTL for logged in users, in seconds
  sessionTTL: 2592000,

  // For testing mostly, delay serving of assets and downloads
  delayServe: 0,
  // For testing mostly, always create a new storage
  // (leaking old ones, potentially)
  forceNewStorage: false,
};
