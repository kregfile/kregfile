"use strict";

const {spawn} = require("child_process");
const {PromisePool} = require("./util");
const CONFIG = require("./config");

const JAIL = CONFIG.get("jail");
if (!JAIL) {
  console.warn("Not jailing");
}
const EXIFTOOL = CONFIG.get("exiftool");


async function getMetaData(file) {
  console.debug("GMD", file);
  const rv = {type: "file", mime: "text/plain", tags: {}, meta: {}};
  if (!EXIFTOOL) {
    return rv;
  }

  let exiftool;
  if (JAIL) {
    // XXX
  }
  else {
    exiftool = spawn(EXIFTOOL, ["-j", "-all", file], {
      stdio: ["ignore", "pipe", "ignore"]
    });
  }

  const [data] = JSON.parse(await new Promise((resolve, reject) => {
    let buf = "";
    exiftool.stdout.on("data", d => buf += d);
    exiftool.on("error", reject);
    exiftool.on("exit", () => resolve(buf));
  }));
  const {
    MIMEType = rv.mime,
    FileType = "Binary",
    ImageWidth,
    ImageHeight,
    Title,
    Description,
    Album,
    Artist,
    Author,
    CompressorID,
    AudioBitrate,
    Duration,
    AvgBitrate,
  } = data;
  rv.meta.type = FileType;

  const m = MIMEType.match(/^(image|video|audio)\//);
  if (m) {
    rv.mime = MIMEType;
    [, rv.type] = m;
  }
  else if (MIMEType.startsWith("text/")) {
    rv.mime = "text/plain";
    rv.type = "document";
  }
  else {
    rv.mime = "application/octet-stream";
    // XXX docs and archives
    rv.type = "file";
  }
  if (ImageWidth && ImageHeight) {
    rv.meta.width = ImageWidth;
    rv.meta.height = ImageHeight;
  }

  function add(branch, where, what) {
    what = what && what.replace(/[\s\0]+/g, " ").trim();
    if (what) {
      rv[branch][where] = what;
    }
  }

  add("tags", "title", Title);
  add("tags", "title", Description);
  add("tags", "album", Album);
  add("tags", "artist", Author);
  add("tags", "artist", Artist);

  add("meta", "codec", CompressorID);
  add("meta", "bitrate", AudioBitrate);
  add("meta", "bitrate", AvgBitrate);
  add("meta", "duration", Duration);

  console.debug(rv, data);

  return rv;
}

module.exports = {
  getMetaData: PromisePool.wrapNew(5, null, getMetaData),
};
