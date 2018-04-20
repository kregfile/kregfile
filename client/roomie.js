"use strict";

import registry from "./registry";
import {debounce} from "./util";
import {APOOL} from "./animationpool";

const ALLOW_DRIFT = 200;

export default new class Roomie {
  constructor() {
    this._name = "New Room";
    this.motd = null;
    this.unread = 0;
    this.hidden = document.hidden;
    this.drift = 0;
    this.tooltip = null;
    this.tooltipid = null;
    this._ttinfo = null;
    this._installTooltip = debounce(this._installTooltip.bind(this), 250);

    this.incrUnread = this.incrUnread.bind(this);
    this.mousepos = Object.seal({x: 0, y: 0});
    this.onmousemove = this.onmousemove.bind(this);

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
      this.name = v;
    });

    registry.config.on("set-motd", v => {
      if (JSON.stringify(this.motd) === JSON.stringify(v)) {
        return;
      }
      this.motd = v;
      registry.messages.showMOTD();
    });

    registry.messages.on("message", this.incrUnread);
    registry.files.on("file-added", this.incrUnread);

    document.addEventListener("visibilitychange", () => {
      this.hidden = document.hidden;
      if (!this.hidden) {
        this.unread = 0;
      }
      this._updateTitle();
    });
  }

  onmousemove(e) {
    const x = this.mousepos.x = e.pageX;
    const y = this.mousepos.y = e.pageY;
    if (this.tooltip) {
      this.tooltip.position(x, y);
    }
  }

  installTooltip(id, tip, e) {
    this._ttinfo = {id, tip};
    if (e) {
      this.onmousemove(e);
    }
    this._installTooltip();
  }

  _installTooltip() {
    if (!this._ttinfo) {
      return;
    }
    const {id, tip} = this._ttinfo;
    this._ttinfo = null;
    if (tip === this.tooltip) {
      return;
    }
    if (this.tooltip) {
      this.hideTooltip();
    }
    this.tooltip = tip;
    this.tooltipid = id;
    document.body.appendChild(tip.el);
    document.body.addEventListener("mousemove", this.onmousemove);
    APOOL.schedule(null, () => {
      if (!this.tooltip) {
        return;
      }
      const {x, y} = this.mousepos;
      this.tooltip.position(x, y);
      this.tooltip.show();
    });
  }

  hideTooltip(id) {
    if (this._ttinfo && this._ttinfo.id === id) {
      this._ttinfo = null;
    }
    if (!this.tooltip) {
      return;
    }
    if (id && this.tooltipid !== id) {
      return;
    }
    this.tooltip.remove();
    this.tooltip = null;
    document.body.removeEventListener("mousemove", this.onmousemove);
  }

  incrUnread() {
    if (!this.hidden) {
      return;
    }
    this.unread++;
    this._updateTitle();
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
