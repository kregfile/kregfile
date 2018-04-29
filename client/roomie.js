"use strict";

import EventEmitter from "events";
import registry from "./registry";
import {dom, debounce, openInNew, nukeEvent} from "./util";
import {APOOL} from "./animationpool";
import {ContextMenu} from "./contextmenu";
import {MessageBox} from "./modal";
import {LoginModal} from "./roomie/logindlg";
import {BanModal, UnbanModal} from "./roomie/bandlg";
import {BlacklistModal} from "./roomie/bldlg";

const ALLOW_DRIFT = 200;

export default new class Roomie extends EventEmitter {
  constructor() {
    super();
    this._name = "New Room";
    this.motd = null;
    this.menu = document.querySelector("#menu");
    this.menu.addEventListener("click", this.onmenu.bind(this));
    this.context = new ContextMenu("#context-menu");
    this.unread = 0;
    this.hidden = document.hidden;
    this.drift = 0;
    this.tooltip = null;
    this.tooltipid = null;
    this._ttinfo = null;
    this.modals = new Set();
    this._mouseMoveInstalled = false;
    this._installTooltip = debounce(this._installTooltip.bind(this), 250);

    this.incrUnread = this.incrUnread.bind(this);
    this.mousepos = Object.seal({x: 0, y: 0});
    this.onmousemove = this.onmousemove.bind(this);
    this.onmouseout = this.onmouseout.bind(this);
    this.onmodalkey = this.onmodalkey.bind(this);

    Object.seal(this);

    document.querySelector("#ips").addEventListener("click", () => {
      document.body.classList.toggle("noips");
      this.emit("ips");
    });

    addEventListener("mouseout", this.onmouseout, true);
    const ces = [
      "home", "report", "options",
      "ban", "unban",
      "register", "login", "account", "logout"
    ];
    for (const ce of ces) {
      this.context.on(`ctx-${ce}`, this[`onctx${ce}`].bind(this));
    }
  }

  onctxhome() {
    openInNew("/");
  }

  onctxreport() {
  }

  onctxoptions() {
  }

  async onctxban() {
    await this.showBanModal();
  }

  async onctxunban() {
    await this.showUnbanModal();
  }

  onctxregister() {
    openInNew("/register");
  }

  async onctxlogin() {
    try {
      await this.showModal(new LoginModal(this));
    }
    catch (ex) {
      // ignored
    }
  }

  onctxaccount() {
    openInNew("/account");
  }

  async onctxlogout() {
    try {
      await registry.socket.rest("logout");
      registry.socket.emit("session", null);
      registry.messages.add({
        user: "System",
        role: "system",
        volatile: true,
        msg: "Successfully logged out!"
      });
    }
    catch (ex) {
      await this.showMessage(ex.message || ex, "Error");
    }
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
    registry.socket.on("authed", authed => {
      document.body.classList[authed ? "add" : "remove"]("authed");
      document.body.classList[!authed ? "add" : "remove"]("unauthed");
    });
    registry.socket.on("role", role => {
      document.body.classList[role === "mod" ? "add" : "remove"]("mod");
      document.body.classList[role !== "mod" ? "add" : "remove"]("regular");
    });
    registry.socket.on("owner", owner => {
      document.body.classList[owner ? "add" : "remove"]("owner");
    });

    registry.socket.on("time", v => {
      const now = Date.now();
      const drift = v - now;
      this.drift =
        Math.floor(Math.abs(drift) / ALLOW_DRIFT) *
        (drift < 0 ? -ALLOW_DRIFT : ALLOW_DRIFT);
    });

    registry.config.on("change-roomname", v => {
      this.name = v;
    });

    registry.config.on("change-motd", v => {
      if (JSON.stringify(this.motd) === JSON.stringify(v)) {
        return;
      }
      this.motd = v;
      registry.messages.showMOTD();
    });

    registry.messages.on("message", m => {
      if (m.saved) {
        return;
      }
      this.incrUnread();
    });
    registry.files.on("file-added", (_, replace) => {
      if (replace) {
        return;
      }
      this.incrUnread();
    });

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

  onmenu() {
    if (!this.context.showing) {
      this.context.show(this.menu);
    }
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


  _installMouseMove() {
    if (this._mouseMoveInstalled) {
      return;
    }
    addEventListener("mousemove", this.onmousemove);
    this._mouseMoveInstalled = true;
  }

  _removeMouseMove() {
    if (!this._mouseMoveInstalled) {
      return;
    }
    addEventListener("mousemove", this.onmousemove);
    this._mouseMoveInstalled = false;
  }

  installTooltip(tip, e) {
    this._installMouseMove();
    this._ttinfo = tip;
    if (e) {
      this.onmousemove(e);
    }
    this._installTooltip();
  }

  _installTooltip() {
    if (!this._ttinfo) {
      return;
    }
    const tip = this._ttinfo;
    this._ttinfo = null;
    if (tip === this.tooltip || this.hidden) {
      return;
    }
    if (this.tooltip) {
      this.hideTooltip();
    }
    this.tooltip = tip;
    document.body.appendChild(tip.el);
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

  hideTooltip() {
    if (this._ttinfo) {
      this._removeMouseMove();
      this._ttinfo = null;
    }
    if (!this.tooltip) {
      return;
    }
    this.tooltip.remove();
    this._removeMouseMove();
    this.emit("tooltip-hidden", this.tooltip);
    this.tooltip = null;
  }

  onmodalkey(e) {
    const {key, target: {localName}} = e;
    if (key === "Enter" && (
      localName === "input" || localName === "textarea")) {
      console.log(key, localName);
      return;
    }
    if (key === "Enter" || key === "Escape") {
      const modal = Array.from(this.modals).pop();
      if (!modal) {
        return;
      }
      nukeEvent(e);
      if (key === "Enter") {
        modal.accept();
      }
      else {
        modal.dismiss();
      }
    }
  }

  async showModal(modal) {
    if (this.modals.has(modal)) {
      return modal.promise;
    }
    this.hideTooltip();
    if (!this.modals.size) {
      addEventListener("keydown", this.onmodalkey);
    }
    else {
      this.modals.forEach(e => {
        e.disable();
      });
    }
    this.modals.add(modal);
    const holder = dom("div", {
      classes: ["modal-holder"]
    });
    holder.appendChild(modal.el);
    document.body.appendChild(holder);
    try {
      modal.onshown();
      return await modal.promise;
    }
    finally {
      document.body.removeChild(holder);
      this.modals.delete(modal);
      const newtop = Array.from(this.modals).pop();
      if (newtop) {
        newtop.enable();
      }
      else {
        removeEventListener("keydown", this.onmodalkey);
      }
    }
  }

  async showMessage(text, caption, icon) {
    try {
      console.log(await this.showModal(
        new MessageBox(caption || "Message", text, icon)));
    }
    catch (ex) {
      console.error(ex);
      // don't care
    }
  }

  async question(text, caption, icon, ...buttons) {
    if (!buttons.length) {
      buttons = ["Yes", "No"];
    }
    buttons = buttons.map((e, i, a) => {
      return {
        id: i,
        text: e,
        default: !i,
        cancel: i === a.length - 1
      };
    });
    return await this.showModal(
      new MessageBox(caption || "Message", text, icon, ...buttons));
  }

  async showBanModal(subjects, template) {
    try {
      await this.showModal(new BanModal(this, subjects, template));
    }
    catch (ex) {
      if (ex) {
        console.error(ex);
      }
    }
  }

  async showUnbanModal(subjects) {
    try {
      await this.showModal(new UnbanModal(this, subjects));
    }
    catch (ex) {
      if (ex) {
        console.error(ex);
      }
    }
  }

  async showBlacklistModal(files, template) {
    try {
      await this.showModal(new BlacklistModal(this, files, template));
    }
    catch (ex) {
      if (ex) {
        console.error(ex);
      }
    }
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
      `${n.user} | ${this.name} | ${registry.config.get("name")}`,
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
    document.title = `${title} - ${registry.config.get("name")}`;
    this.emit("title", title);
  }

  _updateTitleAndName() {
    this._updateTitle();
    document.querySelector("#name").textContent = this.name;
  }
}();
