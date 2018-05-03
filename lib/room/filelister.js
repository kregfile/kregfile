"use strict";

const {EMITTER: UPLOADS} = require("../upload");
const BROKER = require("../broker");
const {HashesSet} = require("../hashesset");
const {CoalescedUpdate} = require("../util");


function sanitizeFile(file) {
  file = file.toClientJSON();
  delete file.ip;
  delete file.admin;
  delete file.tags.hidden;
  return file;
}

class FileLister {
  constructor(room) {
    this.room = room;
    this.files = [];
    this.lastFiles = new Map();
    this.hashes = new HashesSet();
    this.privileged = [];
    this.regular = [];
    this.ips = new Set();
    this.dirty = true;

    this.onadded = new CoalescedUpdate(1000, files => {
      files.forEach(e => {
        const j = JSON.stringify(e.toClientJSON());
        this.lastFiles.set(e.key, j);
      });
      this.room.emit("files", "add", files);
    });

    this.ondeleted = new CoalescedUpdate(250, files => {
      files.forEach(e => {
        this.lastFiles.delete(e.key);
      });
      this.room.emit("files", "deleted", files);
    });

    function update(type, files) {
      files = files.filter(e => {
        const j = JSON.stringify(e.toClientJSON());
        const rv = this.lastFiles.get(e.key) !== j;
        this.lastFiles.set(e.key, j);
        return rv;
      });
      if (!files.length) {
        return;
      }
      this.dirty = true;
      this.room.emit("files", type, files);
    }

    this.onupdated = new CoalescedUpdate(2000, update.bind(this, "updated"));
    this.onhidden = new CoalescedUpdate(100, update.bind(this, "hidden"));

    this.onfile = this.onfile.bind(this);
    this.onstorageupdate = this.onstorageupdate.bind(this);
    this.onstoragehidden = this.onstoragehidden.bind(this);
    this.onclear = this.onclear.bind(this);
    Object.seal(this);

    UPLOADS.on(this.room.roomid, this.onfile);
    BROKER.on("storage-updated", this.onstorageupdate);
    BROKER.on("storage-hidden", this.onstoragehidden);
    UPLOADS.on("clear", this.onclear);
  }

  onfile(action, file) {
    if (action === "add") {
      this.files.push(file);
      this.hashes.add(file);
      this.dirty = true;
      this.onadded.add(file);
      return;
    }

    if (action === "delete") {
      const idx = this.files.findIndex(e => file === e);
      if (idx < 0) {
        return;
      }
      this.files.splice(idx, 1);
      this.hashes.delete(file);
      this.dirty = true;
      this.ondeleted.add(file);
      return;
    }

    if (action === "update") {
      const idx = this.files.findIndex(e => file.key === e.key);
      if (idx < 0) {
        return;
      }
      const [existing] = this.files.splice(idx, 1, file);
      if (existing.hidden !== file.hidden) {
        this.onhidden.add(file);
      }
      else {
        this.onupdated.add(file);
      }
      this.hashes.delete(existing);
      this.hashes.add(file);
      this.dirty = true;
      return;
    }
    console.warn("Upload action not handled", action);
  }

  onstorageupdate(hash) {
    const files = this.hashes.get(hash);
    if (!files) {
      return;
    }
    files.forEach(file => this.onupdated.add(file));
  }

  onstoragehidden(hash) {
    const files = this.hashes.get(hash);
    if (!files) {
      return;
    }
    files.forEach(file => this.onhidden.add(file));
  }

  onclear() {
    this.files.length = 0;
    this.hashes.clear();
    this.regular.length = 0;
    this.ips.clear();
    this.dirty = false;
    this.room.emit("clear");
  }

  async _filterFiles(files) {
    await this.undirty();
    files = new Set(files);
    files = this.files.filter(e => files.has(e.key));
    return files;
  }

  async trash(files) {
    files = await this._filterFiles(files);
    await UPLOADS.trash(files);
    return files.length;
  }

  async blacklist(mod, options, files) {
    files = await this._filterFiles(files);
    await UPLOADS.blacklist(this.room.roomid, mod, options, files);
  }

  async whitelist(mod, files) {
    files = await this._filterFiles(files);
    await UPLOADS.whitelist(this.room.roomid, mod, files);
  }

  async undirty() {
    if (!this.dirty) {
      return;
    }
    this.files = await UPLOADS.for(this.room);
    this.hashes = new HashesSet();
    this.files.forEach(f => this.hashes.add(f));
    this.ips = new Set(this.files.map(f => f.ip));
    this.privileged = this.files.
      map(f => f.toClientJSON());
    this.regular = this.files.
      filter(f => !f.hidden).
      map(sanitizeFile);
    this.dirty = false;
  }

  async for(role, ip) {
    await this.undirty();
    if (role === "mod") {
      return this.privileged;
    }
    if (this.ips.has(ip)) {
      return this.files.
        filter(f => !f.hidden || f.ip === ip).
        map(sanitizeFile);
    }
    return this.regular;
  }

  async get(key, role, ip) {
    const file = await UPLOADS.get(key);
    if (!file) {
      throw new Error("Unknown file");
    }
    if (role === "mod") {
      return file.toClientJSON();
    }
    if (file.ip !== ip && file.hidden) {
      throw new Error("Unknown file");
    }
    return sanitizeFile(file);
  }

  convert(files, role, ip) {
    if (role === "mod") {
      return files.map(f => f.toClientJSON());
    }
    return files.
      filter(f => !f.hidden || f.ip === ip).
      map(sanitizeFile);
  }

  kill() {
    UPLOADS.removeListener(this.room.roomid, this.onfile);
    BROKER.removeListener("storage-update", this.onstorageupdate);
    BROKER.removeListener("storage-hidden", this.onstoragehidden);
    UPLOADS.removeListener("clear", this.onclear);
    this.files.length = this.regular.length = 0;
    this.ips.clear();
  }
}

module.exports = { FileLister };
