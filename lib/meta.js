"use strict";

const fs = require("fs");
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
const FFMPEG = CONFIG.get("ffmpeg");

const PROFILE = path.join(__dirname, "..", "jail.profile");

const wrap = PromisePool.wrapNew;

const SHARP_DIMENSIONS = [
  [1920, 1080],
  [1280, 720],
  [400, 900],
  [200, 200],
];

const RE_SANI = new XRegExp("\\p{C}+", "g");

async function runcmd(cmdargs, encoding) {
  let cmd = cmdargs.shift();
  cmd = spawn(cmd, cmdargs, {
    encoding,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return await new Promise((resolve, reject) => {
    let out;
    let err;
    if (encoding) {
      out = "";
      err = "";
      cmd.stdout.on("data", d => out += d);
      cmd.stderr.on("data", d => err += d);
    }
    else {
      out = [];
      err = [];
      cmd.stdout.on("data", d => out.push(d));
      cmd.stderr.on("data", d => err.push(d));
    }
    cmd.on("error", reject);
    cmd.on("exit", (code, signal) => {
      if (code || signal) {
        reject(code || signal);
        return;
      }
      if (!encoding) {
        out = Buffer.concat(out);
        err = Buffer.concat(err);
      }
      resolve([out, err]);
    });
  });
}

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
  let args;
  const ffargs = [
    "-t", "10",
    "-map", "v:0", "-map_metadata", "-1",
    "-c:v", "libx264", "-preset:v", "veryfast", "-crf", "27",
    "-profile:v", "baseline",
    "-movflags", "+faststart",
    "-fflags", "+bitexact",
    "-vf", "scale=200:-1,crop=iw-'mod(iw,4)':ih-'mod(ih,4)'",
  ];
  const inf = storage.full;
  const outf = `${inf}.mp4`;
  if (JAIL) {
    const i = path.parse(inf);
    const o = path.parse(outf);
    args = [
      "firejail", "--quite", "--profile", PROFILE, "--private", i.dir,
      FFMPEG, "-y", "-ss", "2", "-i", i.base].concat(ffargs);
    args.push(o.base);
  }
  else {
    args = [FFMPEG, "-y", "-ss", "2", "-i", inf].concat(ffargs);
    args.push(outf);
  }
  try {
    await runcmd(args, "utf-8");
    await storage.addAssets([{
      ext: ".mp4",
      type: "video",
      mime: "video/mp4",
      file: outf,
    }]);
  }
  catch (ex) {
    console.error(ex);
    fs.unlink(outf);
  }
}

async function generateAssetsAudio(storage) {
  if (!storage.meta.haspic) {
    return;
  }
  let exiftool;
  if (JAIL) {
    const p = path.parse(storage.full);
    exiftool = [
      "firejail",
      "--quite", "--profile", PROFILE, "--private", p.dir,
      EXIFTOOL, "-b", "-Picture", p.base
    ];
  }
  else {
    exiftool = [EXIFTOOL, "-b", "-Picture", storage.full];
  }

  try {
    const [binary] = await runcmd(exiftool, null);
    const {data, info: {width, height}} = await sharp(binary).
      limitInputPixels(Math.pow(8000, 2)).
      rotate().
      resize(200, 200).
      withoutEnlargement().
      max().
      flatten().
      background().
      jpeg({force: true, quality: 70}).
      toBuffer({resolveWithObject: true});
    storage.addAssets([{
      ext: ".cover.jpg",
      type: "image",
      mime: "image/jpeg",
      width,
      height,
      data
    }]);
  }
  catch (ex) {
    console.error("Failed to extract cover", ex);
  }
}

async function generateAssets(storage) {
  const {mime} = storage;
  if (mime.startsWith("image/")) {
    return await generateAssetsImage(storage);
  }
  if (mime.startsWith("video/")) {
    return await generateAssetsVideo(storage);
  }
  if (mime.startsWith("audio/")) {
    return await generateAssetsAudio(storage);
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
    exiftool = [
      "firejail",
      "--quite", "--profile", PROFILE, "--private", p.dir,
      EXIFTOOL, "-j", "-all", p.base
    ];
  }
  else {
    exiftool = [EXIFTOOL, "-j", "-all", file];
  }

  const [json] = await runcmd(exiftool, "utf-8");
  const [data] = JSON.parse(json);
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
    Picture,
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
  add("meta", "haspic", (!!Picture).toString());

  console.debug(rv, data);

  return rv;
}

module.exports = {
  getMetaData: wrap(CONFIG.get("maxMetaProcesses"), null, getMetaData),
  generateAssets: wrap(CONFIG.get("maxAssetsProcesses"), null, generateAssets),
};
