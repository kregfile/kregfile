"use strict";

const {Ban} = require("./singles");

class ActiveBan {
  constructor(data) {
    this.mute = null;
    this.upload = null;
    this.hellban = null;
    Object.assign(this, data);
    Object.seal(this);
  }

  get any() {
    let rv = false;
    if (this.mute && !this.mute.expired) {
      rv = true;
    }
    else {
      this.mute = null;
    }
    if (this.upload && !this.upload.expired) {
      rv = true;
    }
    else {
      this.upload = null;
    }
    if (this.hellban && !this.hellban.expired) {
      rv = true;
    }
    else {
      this.hellban = null;
    }
    return rv;
  }

  merge(ban) {
    let rv = false;
    for (const t of ["mute", "upload", "hellban"]) {
      if (!ban[t]) {
        continue;
      }
      if (!this[t] || this[t].expires < ban.expires) {
        this[t] = ban;
        rv = true;
      }
    }
    return rv;
  }

  remove(unban) {
    let rv = false;
    for (const t of ["mute", "upload", "hellban"]) {
      if (!unban[t] || !this[t]) {
        continue;
      }
      this[t] = null;
      rv = true;
    }
    return rv;
  }

  toJSON() {
    return {
      mute: this.mute,
      upload: this.upload,
      hellban: this.hellban,
    };
  }

  static create(ban) {
    const o = {};
    if (ban.mute) {
      o.mute = ban;
    }
    if (ban.upload) {
      o.upload = ban;
    }
    if (ban.hellban) {
      o.hellban = ban;
    }
    return new ActiveBan(o);
  }

  static fromData(data) {
    const rv = new ActiveBan(data);
    for (const t of ["mute", "upload", "hellban"]) {
      if (rv[t]) {
        rv[t] = new Ban(rv[t]);
      }
    }
    return rv;
  }
}

module.exports = { ActiveBan };
