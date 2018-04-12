"use strict";

import registry from "./registry";

export default new class Roomie {
  constructor() {
    this._name = "New Room";
    this.unread = 0;
    this.hidden = document.hidden;

    Object.seal(this);
  }

  init() {
    registry.socket.on("usercount", v => {
      document.querySelector("#usercount").textContent = v;
    });

    registry.config.on("set-roomname", v => this.name = v);

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


  _updateTitle() {
    const unread = this.unread ? `(${this.unread}) ` : "";
    document.title = `${unread}${this.name} - kregfile`;
  }

  _updateTitleAndName() {
    this._updateTitle();
    document.querySelector("#name").textContent = this.name;
  }
}();
