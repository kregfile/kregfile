"use strict";

const {v4: uuidv4} = require("uuid");
const {plural} = require("../util");

class WhitelistRecord {
  constructor(data) {
    Object.assign(this, data);
  }

  clone() {
    return new WhitelistRecord(this.toJSON());
  }

  toLogMessage() {
    const unique = new Set(this.files.map(f => f.hash));
    const wl = `${plural(this.files.length, "file", "files")} (${unique.size} unique)`;
    return [
      {t: "p", v: this.mod.name, r: this.mod.role},
      {t: "t", v: ` whitelisted ${wl}`},
    ];
  }

  toJSON() {
    return {
      recordType: "whitelist",
      roomid: this.roomid,
      id: this.id,
      mod: this.mod,
      issued: this.issued,
      files: this.files.slice(),
    };
  }

  static create(roomid, mod, files) {
    const o = Object.assign({
      id: uuidv4(),
      roomid,
      mod: {
        name: mod.name,
        role: mod.role
      },
      issued: Date.now(),
      files: files || [],
    });
    if (typeof o.mod.name !== "string") {
      throw new Error("Invalid mod");
    }
    return new WhitelistRecord(o).clone();
  }
}

module.exports = { WhitelistRecord };
