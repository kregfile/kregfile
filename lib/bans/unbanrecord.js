"use strict";

const {v4: uuidv4} = require("uuid");
const {plural} = require("../util");
const {Base, Unban} = require("./singles");

class UnbanRecord extends Base {
  clone() {
    return new UnbanRecord(this.toJSON());
  }

  toJSON() {
    return Object.assign(super.toJSON(), {
      recordType: "unban",
      roomid: this.roomid,
      id: this.id,
      accounts: this.accounts.slice(),
      ips: this.ips.slice(),
    });
  }

  _one(type, subject) {
    return new Unban(Object.assign(super.toJSON(), {
      recordId: this.id,
      type,
      subject,
    }));
  }

  toUnbans() {
    return this.ips.map(i => this._one("ip", i)).
      concat(this.accounts.map(a => this._one("account", a)));
  }

  toLogMessage() {
    let accounts = this.accounts.join(", ");
    if (!accounts) {
      accounts = plural(this.ips.length, "IP", "IPs");
    }
    else if (this.ips.length) {
      accounts += ` and ${plural(this.ips.length, "IP", "IPs")}`;
    }
    let actions = [];
    if (this.mute) {
      actions.push("unmuted");
    }
    if (this.upload) {
      actions.push("unbanned");
    }
    if (this.hellban) {
      actions.push("unhellbanned");
    }
    actions = actions.join(", ");
    if (!actions) {
      actions = "did nothing to";
    }

    const msg = [
      {t: "p", v: this.mod.name, r: this.mod.role},
      {t: "t", v: ` ${actions} ${accounts}`},
    ];
    if (this.reason) {
      msg.push(
        {t: "b"},
        {t: "t", v: this.reason}
      );
    }
    return msg;
  }

  static create(roomid, mod, subjects, options) {
    const o = Object.assign({
      id: uuidv4(),
      roomid,
      mod: {
        name: mod.name,
        role: mod.role
      },
      issued: Date.now(),
    }, subjects, options);
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
    return new UnbanRecord(o).clone();
  }
}


module.exports = { UnbanRecord };
