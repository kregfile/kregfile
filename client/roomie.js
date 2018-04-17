"use strict";

import registry from "./registry";

const ALLOW_DRIFT = 200;

export default new class Roomie {
  constructor() {
    this._name = "New Room";
    this.motd = null;
    this.unread = 0;
    this.hidden = document.hidden;
    this.drift = 0;

    Object.seal(this);
  }

  init() {
    registry.socket.on("usercount", v => {
      document.querySelector("#usercount").textContent = v;
    });

    registry.socket.on("time", v => {
      const now = Date.now();
      const drift = v - now;
      this.drift =
        Math.floor(Math.abs(drift) / ALLOW_DRIFT) *
        (drift < 0 ? -ALLOW_DRIFT : ALLOW_DRIFT);
    });

    registry.config.on("set-roomname", v => {
      console.log(v);
      this.name = v;
    });

    registry.config.on("set-motd", v => {
      if (JSON.stringify(this.motd) === JSON.stringify(v)) {
        return;
      }
      this.motd = v;
      registry.messages.showMOTD();
    });

    registry.messages.on("message", () => {
      if (!this.hidden) {
        return;
      }
      this.unread++;
      this._updateTitle();
    });

    document.addEventListener("visibilitychange", () => {
      this.hidden = document.hidden;
      if (!this.hidden) {
        this.unread = 0;
      }
      this._updateTitle();
    });
  }

  get name() {
    return this._name;
  }

  set name(nv) {
    this._name = nv || "";
    this._updateTitleAndName();
  }

  async displayNotification(n) {
    if (!("Notification" in window)) {
      return;
    }
    if (Notification.permission === "denied") {
      return;
    }
    if (Notification.permission !== "granted") {
      await Notification.requestPermission();
    }
    if (Notification.permission !== "granted") {
      return;
    }
    const opts = {
      icon: "/favicon.ico",
      body: n.msg,
      silent: true,
      noscreen: true,
    };
    const notification = new Notification(
      `${n.user} | ${this.name} | kregfile`,
      opts);
    setTimeout(notification.close.bind(notification), 10000);
  }

  toServerTime(localTime) {
    if (!localTime) {
      localTime = Date.now();
    }
    return localTime + this.drift;
  }

  diffTimes(remote, local) {
    return remote - this.toServerTime(local);
  }


  _updateTitle() {
    const unread = this.unread ? `(${this.unread}) ` : "";
    document.title = `${unread}${this.name} - kregfile`;
  }

  _updateTitleAndName() {
    this._updateTitle();
    document.querySelector("#name").textContent = this.name;
  }
}();
