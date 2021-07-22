"use strict";

const {v4: uuidv4} = require("uuid");
const {toPrettyDuration, plural} = require("../util");
const {Ban, BaseBan} = require("./singles");

class BanRecord extends BaseBan {
  clone() {
    return new BanRecord(this.toJSON());
  }

  toJSON() {
    return Object.assign(super.toJSON(), {
      recordType: "ban",
      id: this.id,
      roomid: this.roomid,
      accounts: this.accounts.slice(),
      ips: this.ips.slice(),
      files: this.files.slice(),
    });
  }

  _one(type, subject) {
    return new Ban(Object.assign(super.toJSON(), {
      recordId: this.id,
      roomid: this.roomid,
      type,
      subject,
    }));
  }

  nuke(ban) {
    const a = ban.type === "ip" ? this.ips : this.accounts;
    const idx = a.indexOf(ban.subject);
    if (idx >= 0) {
      a.splice(idx, 1);
    }
  }

  toBans() {
    return this.ips.map(i => this._one("ip", i)).
      concat(this.accounts.map(a => this._one("account", a)));
  }

  toLogMessage() {
    let accounts = this.accounts.join(", ");
    if (!accounts) {
      if (!this.ips.length) {
        accounts = "literally nobody";
      }
      else {
        accounts = plural(this.ips.length, "IP", "IPs");
      }
    }
    else if (this.ips.length) {
      accounts += ` and ${plural(this.ips.length, "IP", "IPs")}`;
    }
    let actions = [];
    if (this.mute) {
      actions.push("muted");
    }
    if (this.upload) {
      actions.push("banned");
    }
    if (this.hellban) {
      actions.push("hellbanned");
    }
    actions = actions.join(", ");
    if (!actions) {
      actions = "did nothing to";
    }
    const duation = toPrettyDuration(this.expires - this.issued);
    let bl = "";
    if (this.files.length) {
      const unique = new Set(this.files.map(f => f.hash));
      bl = ` and blacklisted ${plural(this.files.length, "file", "files")} (${unique.size} unique)`;
    }
    const msg = [
      {t: "p", v: this.mod.name, r: this.mod.role},
      {t: "t", v: ` ${actions} ${accounts} for ${duation}${bl}`},
    ];
    if (this.reason) {
      msg.push(
        {t: "b"},
        {t: "t", v: this.reason}
      );
    }
    return msg;
  }

  async revert(mod) {
    if (this.files && this.files.length) {
      await require("../upload").EMITTER.whitelist(
        this.roomid,
        mod,
        this.files
      );
    }

    return await require("./").unban(
      this.roomid,
      mod,
      {
        ips: this.ips,
        accounts: this.accounts,
      },
      {
        mute: true,
        upload: true,
        hellban: true
      }
    );
  }

  static create(roomid, mod, subjects, options, files) {
    const o = Object.assign({
      id: uuidv4(),
      roomid,
      mod: {
        name: mod.name,
        role: mod.role
      },
      files: files || [],
      issued: Date.now(),
    }, subjects, options);
    if (typeof o.hours !== "number" || !isFinite(o.hours) || o.hours < 0) {
      throw new Error("Invalid duration");
    }
    if (!Array.isArray(o.ips) || !Array.isArray(o.accounts)) {
      throw new Error("Invalid subjects");
    }
    if (typeof o.mod.name !== "string") {
      throw new Error("Invalid mod");
    }
    o.reason = o.reason || "";
    o.mute = !!o.mute;
    o.upload = !!o.upload;
    o.hellban = !!o.hellban;
    o.expires = o.issued + Math.min(o.hours, 365 * 24) * 60 * 60 * 1000;
    delete o.hours;
    return new BanRecord(o).clone();
  }
}

module.exports = {BanRecord};
