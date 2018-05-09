"use strict";

const {toPrettyDuration} = require("../util");

class Base {
  constructor(data) {
    Object.assign(this, data);
  }

  toJSON() {
    return {
      reason: this.reason,
      mute: this.mute,
      upload: this.upload,
      hellban: this.hellban,
      issued: this.issued,
      mod: this.mod,
    };
  }
}

class BaseBan extends Base {
  toJSON() {
    return Object.assign(super.toJSON(), {
      expires: this.expires,
    });
  }
}

class Ban extends BaseBan {
  toJSON() {
    return Object.assign(super.toJSON(), {
      recordId: this.recordId,
      roomid: this.roomid,
      type: this.type,
      subject: this.subject,
    });
  }

  get remaining() {
    return this.expires - Date.now();
  }

  get expired() {
    return this.remaining < 0;
  }

  get duration() {
    return this.expires - this.issued;
  }

  toUserMessage(type) {
    let action;
    switch (type) {
    case "mute":
      action = "muted";
      break;

    case "upload":
      action = "banned from uploading";
      break;

    default:
      throw new Error("No message");
    }
    return `You're ${action} for another ${toPrettyDuration(this.remaining)} because: ${this.reason}`;
  }
}

class Unban extends Base {
  constructor(data) {
    super(data);
    Object.seal(this);
  }

  toJSON() {
    return Object.assign(super.toJSON(), {
      recordId: this.recordId,
      type: this.type,
      subject: this.subject,
    });
  }
}

module.exports = { Base, BaseBan, Ban, Unban };
