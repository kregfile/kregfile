"use strict";

import EventEmitter from "events";
import registry from "./registry";
import {debounce} from "./util";
import {APOOL} from "./animationpool";

const ALLOW_DRIFT = 200;

export default new class Roomie extends EventEmitter {
  constructor() {
    super();
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
    this.onmouseout = this.onmouseout.bind(this);

    Object.seal(this);

    addEventListener("mouseout", this.onmouseout, true);
  }

  init() {
    registry.socket.on("usercount", v => {
      document.querySelector("#usercount").textContent = v;
    });
    const connection = document.querySelector("#connection");
    registry.socket.on("reconnecting", () => {
      connection.classList.add("visible");
    });
    registry.socket.on("connect", () => {
      connection.classList.remove("visible");
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
        this.emit("unread", this.unread);
        this.hideTooltip();
      }
      this._updateTitle();
      this.emit("hidden", this.hidden);
    });
  }

  onmousemove(e) {
    const x = this.mousepos.x = e.pageX;
    const y = this.mousepos.y = e.pageY;
    if (this.tooltip) {
      this.tooltip.position(x, y);
    }
  }

  onmouseout() {
    this.hideTooltip();
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
    if (tip === this.tooltip || this.hidden) {
      return;
    }
    if (this.tooltip) {
      this.hideTooltip();
    }
    this.tooltip = tip;
    this.tooltipid = id;
    document.body.appendChild(tip.el);
    addEventListener("mousemove", this.onmousemove);
    APOOL.schedule(null, () => {
      if (!this.tooltip) {
        return;
      }
      const {x, y} = this.mousepos;
      this.tooltip.position(x, y);
      this.tooltip.show();
      this.emit("tooltip-shown", this.tooltip);
    });
  }

  hideTooltip(id) {
    if (this._ttinfo && (!id || this._ttinfo.id === id)) {
      this._ttinfo = null;
    }
    if (!this.tooltip) {
      return;
    }
    if (id && this.tooltipid !== id) {
      return;
    }
    this.tooltip.remove();
    removeEventListener("mousemove", this.onmousemove);
    this.emit("tooltip-hidden", this.tooltip);
    this.tooltip = null;
  }

  incrUnread() {
    if (!this.hidden) {
      return;
    }
    this.unread++;
    this._updateTitle();
    this.emit("unread", this.unread);
  }

  get name() {
    return this._name;
  }

  set name(nv) {
    this._name = nv || "";
    this._updateTitleAndName();
    this.emit("name", this._name);
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
    const title = `${unread}${this.name}`;
    document.title = `${title} - kregfile`;
    this.emit("title", title);
  }

  _updateTitleAndName() {
    this._updateTitle();
    document.querySelector("#name").textContent = this.name;
  }
}();
