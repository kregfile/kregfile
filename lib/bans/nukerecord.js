"use strict";

const {v4: uuidv4} = require("uuid");

class NukeRecord {
  constructor(data) {
    Object.assign(this, data);
  }

  clone() {
    return new NukeRecord(this.toJSON());
  }

  toLogMessage() {
    return [
      {t: "p", v: this.mod.name, r: this.mod.role},
      {t: "t", v: " nuked "},
      {t: "r", v: this.roomid},
    ];
  }

  toJSON() {
    return {
      recordType: "nuke",
      roomid: this.roomid,
      id: this.id,
      mod: this.mod,
      issued: this.issued,
    };
  }

  static create(roomid, mod) {
    const o = Object.assign({
      id: uuidv4(),
      roomid,
      mod: {
        name: mod.name,
        role: mod.role
      },
      issued: Date.now(),
    });
    if (typeof o.mod.name !== "string") {
      throw new Error("Invalid mod");
    }
    return new NukeRecord(o).clone();
  }
}

module.exports = { NukeRecord };
