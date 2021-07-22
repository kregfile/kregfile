"use strict";

const fs = require("fs");
const path = require("path");
const {promisify} = require("util");
const mkdirp = require("mkdirp");
const CONFIG = require("./config");
const BROKER = require("./broker");
const {DistributedMap, DistributedSet} = require("./broker/collections");

const UPLOADS_DIR = CONFIG.get("uploads");

const writeFile = promisify(fs.writeFile);
const rmdir = promisify(fs.rmdir);
const unlink = promisify(fs.unlink);

function toskey(s) {
  return `upload:s:${s}`;
}

class StorageLocation {
  constructor(data) {
    this.meta = {};
    this.tags = {};
    this.assets = [];
    this.mime = "application/octet-stream";
    if (typeof data === "string") {
      this.name = data;
    }
    else {
      Object.assign(this, data);
    }
    if (Array.isArray(this.assets)) {
      this.assets = new Map(this.assets);
    }
    else {
      this.assets = new Map();
    }
    this.url = path.join("/", this.name[0], this.name[1], this.name);
    this.dir = path.join(UPLOADS_DIR, this.name[0], this.name[1]);
    this.full = path.join(this.dir, this.name);
    Object.freeze(this);
  }

  async _addAsset(asset) {
    try {
      if (!asset.ext || !asset.type || !asset.mime) {
        throw new Error("Trying to add an incomplete asset");
      }
      if (this.assets.has(asset.ext)) {
        return;
      }
      let full = this.full + asset.ext;
      const {data, file} = asset;
      if (file) {
        full = file;
        delete asset.file;
      }
      else if (!Buffer.isBuffer(data) || !data.length) {
        throw new Error("Trying to add invalid asset data");
      }
      else {
        await writeFile(full, data, {
          encoding: null
        });
      }
      delete asset.data;
      this.assets.set(asset.ext, Object.assign({}, asset));
    }
    catch (ex) {
      console.error(ex);
    }
  }

  async addAssets(assets) {
    if (!this.hash) {
      throw new Error("Cannot add assets to temporary storage");
    }
    await Promise.all(assets.map(this._addAsset.bind(this)));
    STORAGE.set(this.hash, this);
    BROKER.emit("storage-updated", this.hash);
  }

  async mkdir() {
    await mkdirp(this.dir);
  }

  async ref(key) {
    const set = new DistributedSet(toskey(this.name));
    try {
      await set.loaded;
      set.add(key);
    }
    finally {
      set.kill();
    }
  }

  async unref(key) {
    const set = new DistributedSet(toskey(this.name));
    try {
      await set.loaded;
      set.delete(key);
      if (!set.size) {
        console.info(`Deleted ${this}`);
        await this.rm();
        return true;
      }
      return false;
    }
    finally {
      set.kill();
    }
  }

  async rm() {
    try {
      await unlink(this.full);
    }
    catch (ex) {
      console.error(`Failed to remove storage ${this.full}`);
    }
    for (const a of this.assets.values()) {
      try {
        await unlink(this.full + a.ext);
      }
      catch (ex) {
        console.error(`Failed to remove asset storage ${this.full}: `, a);
      }
    }
    try {
      await rmdir(this.dir);
    }
    catch (ex) {
      // ignored
    }
  }

  async openWriteAt(offset) {
    await mkdirp(this.dir);
    return fs.createWriteStream(this.full, {
      encoding: null,
      flags: offset ? "r+" : "w",
      start: offset,
    });
  }

  toJSON() {
    return {
      name: this.name,
      hash: this.hash,
      mime: this.mime,
      type: this.type,
      meta: this.meta,
      tags: this.tags,
      size: this.size,
      assets: Array.from(this.assets.entries()),
    };
  }

  get hidden() {
    return this.tags.hidden;
  }

  set hidden(val) {
    if (!this.hash) {
      throw new Error("Cannot hide temporary storage");
    }
    val = !!val;
    if (val === !!this.tags.hidden) {
      return;
    }
    this.tags.hidden = !!val;
    STORAGE.set(this.hash, this);
    BROKER.emit("storage-hidden", this.hash);
  }

  toString() {
    return `StorageLocation(${this.full})`;
  }
}

const STORAGE = new DistributedMap(
  "upload:storage", v => new StorageLocation(v));


module.exports = {toskey, StorageLocation, STORAGE};
