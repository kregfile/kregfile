"use strict";

const {spawn} = require("child_process");
const path = require("path");
const XRegExp = require("xregexp");
const {PromisePool} = require("./util");
const sharp = require("sharp");
const CONFIG = require("./config");

const JAIL = CONFIG.get("jail");
if (!JAIL) {
  console.warn("Not jailing");
}
const EXIFTOOL = CONFIG.get("exiftool");

const PROFILE = path.join(__dirname, "..", "jail.profile");

const wrap = PromisePool.wrapNew;

const SHARP_DIMENSIONS = [
  [1920, 1080],
  [1280, 720],
  [400, 900],
  [200, 200],
];

const RE_SANI = new XRegExp("\\p{C}+", "g");


async function generateAssetsImage(storage) {
  const assets = [];
  const known = new Set();
  for (const [w, h] of SHARP_DIMENSIONS) {
    try {
      const {data, info: {width, height}} = await sharp(storage.full).
        limitInputPixels(Math.pow(8000, 2)).
        rotate().
        resize(w, h).
        withoutEnlargement().
        max().
        flatten().
        background().
        jpeg({force: true, quality: 70}).
        toBuffer({resolveWithObject: true});
      const k = `${width}x${height}`;
      if (known.has(k)) {
        continue;
      }
      assets.push({
        ext: `.${k}.jpg`,
        type: "image",
        mime: "image/jpeg",
        width,
        height,
        data
      });
      known.add(k);
    }
    catch (ex) {
      console.error(ex);
    }
  }
  await storage.addAssets(assets);
}

async function generateAssetsVideo(storage) {
}

async function generateAssets(storage) {
  const {mime} = storage;
  if (mime.startsWith("image/")) {
    return await generateAssetsImage(storage);
  }
  if (mime.startsWith("video/")) {
    return await generateAssetsVideo(storage);
  }
  return null;
}

async function getMetaData(file) {
  console.debug("GMD", file);
  const rv = {type: "file", mime: "text/plain", tags: {}, meta: {}};
  if (!EXIFTOOL) {
    return rv;
  }

  let exiftool;
  if (JAIL) {
    const p = path.parse(file);
    const args = [
      "--quite", "--profile", PROFILE, "--private", p.dir,
      EXIFTOOL, "-j", "-all", p.base];
    exiftool = spawn("firejail", args, {
      stdio: ["ignore", "pipe", "ignore"]
    });
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
    what = what && what.replace(RE_SANI, "").replace(/[\s\0]+/g, " ").trim();
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
  getMetaData: wrap(CONFIG.get("maxMetaProcesses"), null, getMetaData),
  generateAssets: wrap(CONFIG.get("maxAssetsProcesses"), null, generateAssets),
};
