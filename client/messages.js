"use strict";

import EventEmitter from "events";
import localforage from "localforage";
import {
  debounce,
  dom,
  nukeEvent,
  roleToIcon,
  roleToStatus,
  toMessage,
  toType,
} from "./util";
import {APOOL} from "./animationpool";
import registry from "./registry";
import Tooltip from "./tooltip";
import UserTooltip from "./messages/usertooltip";
import File from "./file";
import Scroller from "./scroller";

const DATE_FORMAT_SHORT = new Intl.DateTimeFormat("en-US", {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const DATE_FORMAT_LONG = new Intl.DateTimeFormat("eu");

export default new class Messages extends EventEmitter {
  constructor() {
    super();
    this.el = document.querySelector("#messages");
    this.scroller = new Scroller(
      this.el, document.querySelector("#chat-scroller"));
    this.endMarker = document.querySelector("#endmarker");
    this.msgs = [];
    this.els = [];
    this.queue = [];
    this.files = new WeakMap();
    this.users = new Map();
    this.flushing = null;
    this.store = localforage.createInstance({
      storeName: "msgs"
    });
    this._save = debounce(this._save.bind(this));
    this.flush = APOOL.wrap(this.flush);
    this.scrollEnd = APOOL.wrap(this.scrollEnd);
    this.onfileenter = this.onfileenter.bind(this);
    this.onuserenter = this.onuserenter.bind(this);
    this.onfileclick = this.onfileclick.bind(this);
    this.onbanclick = this.onbanclick.bind(this);
    this.restoring = [];
    this.bannable = new WeakMap();
    this._waitConfig = null;

    Object.seal(this);
  }

  init() {
    registry.socket.on("message", this.add.bind(this));
    registry.socket.on(
      "removeMessages", APOOL.wrap(this.onremovemessages.bind(this)));

    registry.splitter.on("adjusted", () => {
      this.scrollEnd();
    });

    registry.roomie.on("ips", () => {
      this.scrollEnd();
    });

    registry.chatbox.on("error", e => {
      this.add({
        volatile: true,
        role: "system",
        user: "Error",
        msg: e
      });
    });
    registry.chatbox.on("warn", e => {
      this.add({
        volatile: true,
        role: "system",
        user: "Warning",
        msg: e
      });
    });

    registry.config.on("change-disabled", async v => {
      if (!v) {
        return;
      }
      this.add({
        volatile: true,
        role: "system",
        user: "Warning",
        msg: await toMessage(
          "This room was disabled by a moderator!\nYou cannot post or upload!"),
      });
    });

    this.endMarker.addEventListener("click", () => {
      this.scrollEnd();
    }, { passive: true });
    this.el.addEventListener("scroll", () => {
      if (this.isScrollEnd) {
        this.hideEndMarker();
      }
    }, { passive: true });

    addEventListener("resize", debounce(() => {
      this.scrollEnd();
    }, 500), { passive: true });

    this._waitConfig = new Promise(
      r => registry.config.once("change-historySize", r));
  }

  async completeFile(f) {
    let file = this.files.get(f);
    const local = registry.files.get(file.key);
    if (local) {
      this.files.set(f, local);
      return local;
    }
    if (!file) {
      return null;
    }
    if (file.unknown) {
      return null;
    }
    if (!file.url) {
      try {
        file = await registry.socket.makeCall("fileinfo", file.key);
        if (!file) {
          throw Error("no file");
        }
        file.external = true;
        file = new File(file);
      }
      catch (ex) {
        file.unknown = true;
        return null;
      }
    }
    this.files.set(f, file);
    return file;
  }

  async onfileenter(e) {
    const file = await this.completeFile(e.target);
    if (!file || file.expired || file.unknown) {
      registry.roomie.installTooltip(new Tooltip("File unknown"), e);
      return;
    }
    file.showTooltip(e);
  }

  async onuserenter(e) {
    const {profile, owner} = e.target.dataset;
    if (!profile) {
      return;
    }
    try {
      let info = this.users.get(profile);
      if (!info || info.expires < Date.now()) {
        info = await registry.socket.makeCall("profileinfo", profile);
        if (!info) {
          return;
        }
        info.expires = Date.now() + 120000;
        info.owner = owner;
        this.users.set(profile, info);
        if (this.users.size > 100) {
          this.users.delete(this.users.keys().next().value);
        }
      }
      registry.roomie.installTooltip(new UserTooltip(info), e);
    }
    catch (ex) {
      console.error(ex);
    }
  }

  onfileclick(e) {
    const file = this.files.get(e.target);
    if (!file) {
      return true;
    }
    if (file.expired) {
      return nukeEvent(e);
    }
    if (file.external) {
      return true;
    }
    return file.onclick(e);
  }

  onbanclick(e) {
    nukeEvent(e);
    if (e.altKey) {
      registry.roomie.showRemoveMessagesModal(e.target.dataset.id);
      return;
    }
    const subjects = this.bannable.get(e.target);
    if (e.shiftKey) {
      registry.roomie.showUnbanModal(subjects);
    }
    else {
      registry.roomie.showBanModal(subjects, "spamming");
    }
  }

  async _save() {
    await this._waitConfig;
    const historySize = registry.config.get("historySize") || 300;
    while (this.msgs.length > historySize) {
      this.msgs.shift();
    }
    await this.store.setItem(registry.roomid, this.msgs).
      catch(console.error);
  }

  _add(m) {
    if (m.sdate) {
      m.date = new Date(registry.roomie.fromServerTime(m.sdate));
      delete m.sdate;
    }
    else {
      m.date = m.date || new Date();
    }
    let notify = false;
    if (!("notify" in m)) {
      for (const p of m.msg) {
        if (p.t === "t" && registry.chatbox.checkHighlight(p.v)) {
          notify = true;
          break;
        }
      }
    }
    else if (m.notify) {
      notify = true;
    }
    m.notify = false;

    if (!("highlight" in m)) {
      m.highlight = notify;
    }

    if (m.channel === "log") {
      notify = m.highlight = null;
      delete m.channel;
      delete m.owner;
    }

    if (m.saved) {
      notify = false;
    }

    if (m.volatile) {
      return notify;
    }

    this.emit("message", m);
    m.saved = true;
    this.msgs.push(m);
    this._save();
    return notify;
  }

  translateMessage(m) {
    const d = DATE_FORMAT_SHORT.format(m.date);

    const profile = m.user.toLowerCase();
    const ucls = ["msgcontainer"];
    if (m.role) {
      ucls.push(m.role);
    }

    const e = dom("div", {classes: ["msgcontainer", ...ucls]});
    if (m.role) {
      e.dataset.role = m.role;
    }
    e.dataset.profile = profile;

    ucls.shift();
    ucls.unshift("u");

    if (m.highlight) {
      e.classList.add("hi");
    }

    if (m.me) {
      e.classList.add("me");
    }

    if (!m.raw) {
      let user;
      if (m.role && m.role !== "white" && m.role !== "system") {
        user = dom("a", {
          classes: ucls,
          attrs: {
            href: `/u/${profile}`,
            target: "_blank",
            rel: "nofollow",
          },
          text: m.user
        });
        user.dataset.profile = profile;
        user.dataset.owner = m.owner;
        user.addEventListener(
          "mouseenter", this.onuserenter, { passive: true });
      }
      else {
        user = dom("span", {
          classes: ucls,
          text: m.user
        });
      }

      if (!m.owner && m.role) {
        user.insertBefore(dom("span", {
          classes: ["role", roleToIcon(m.role)],
          attrs: {title: roleToStatus(m.role)},
        }), user.firstChild);
      }
      if (m.owner) {
        user.insertBefore(dom("span", {
          classes: ["i-owner"],
          attrs: {title: "Room Owner"},
        }), user.firstChild);
      }
      const ts = dom("span", {
        attrs: {title: DATE_FORMAT_LONG.format(m.date)},
        classes: ["time"],
        text: d
      });
      user.insertBefore(ts, user.firstChild);

      if (m.ip) {
        user.appendChild(dom("span", {
          classes: ["tag-ip"],
          text: ` (${m.ip})`
        }));
      }
      if (!m.me) {
        user.appendChild(document.createTextNode(":"));
      }

      if (m.admin) {
        const ban = dom("span", {
          classes: ["ban-btn", "i-ban"],
        });
        ban.dataset.id = m.id;
        this.bannable.set(ban, m.admin);
        user.appendChild(ban);
        ban.onclick = this.onbanclick;
      }

      e.appendChild(user);
    }

    const msg = dom("span", {
      classes: ["msg"]
    });
    if (!Array.isArray(m.msg)) {
      m.msg = [{t: "t", v: m.msg}];
    }
    this.addMessageParts(msg, m.msg);
    e.appendChild(msg);

    if (m.channel) {
      e.appendChild(dom("span", {
        classes: ["channel"],
        text: ` (${m.channel})`
      }));
    }

    e.dataset.id = m.id;

    return [e, msg];
  }


  add(m) {
    if (this.restoring) {
      this.restoring.push(m);
      return;
    }
    const notify = this._add(m);
    const [e, msg] = this.translateMessage(m);
    this.queue.push(e);
    if (notify) {
      registry.roomie.displayNotification({
        user: m.user,
        msg: msg.textContent
      }).catch(console.error);
    }
    if (!this.flushing) {
      this.flushing = this.flush();
    }
  }

  addMessageParts(msg, parts) {
    for (const p of parts) {
      switch (p.t) {
      case "b":
        msg.appendChild(dom("br"));
        break;

      case "f": {
        const info = registry.files.get(p.key) || p;
        const url = new URL(info.href, document.location);
        url.pathname += `/${info.name}`;
        const file = dom("a", {
          classes: ["chatfile"],
          attrs: {
            target: "_blank",
            rel: "nofollow",
            href: url.href,
          },
          text: info.name
        });
        const icon = dom("span", {
          classes: ["icon", `i-${toType(info.type)}`],
        });
        file.insertBefore(icon, file.firstChild);
        this.files.set(file, info);
        if (info.client) {
          this.completeFile(file).then(f => {
            if (!f || f.unknown) {
              return;
            }
            icon.className = `icon  i-${toType(f.type)}`;
            file.href = f.url;
            file.lastChild.textContent = f.name;
          }).catch(console.error);
        }
        file.addEventListener("mouseenter", this.onfileenter, {
          passive: true
        });
        file.addEventListener("click", this.onfileclick);
        msg.appendChild(file);
        break;
      }

      case "u": {
        const a = dom("a", {
          attrs: {
            target: "_blank",
            rel: "nofollow,noopener,noreferrer",
            href: p.v,
          },
          text: p.n || p.v.replace(/^https?:\/\//, ""),
        });
        msg.appendChild(a);
        break;
      }

      case "p": {
        const a = dom("span", {
          classes: ["u", p.r],
          text: p.v
        });
        msg.appendChild(a);
        break;
      }

      case "r": {
        const a = dom("a", {
          classes: ["r"],
          attrs: {
            target: "_blank",
            href: `/r/${p.v}`,
          },
          text: `${p.n || p.v}`,
        });
        msg.appendChild(a);
        break;
      }

      case "raw": {
        if (typeof p.h === "string") {
          const node = dom("span", {classes: ["raw"]});
          node.innerHTML = p.h;
          msg.appendChild(node);
        }
        else {
          msg.appendChild(p.h);
        }
        break;
      }

      default:
        msg.appendChild(document.createTextNode(p.v));
        break;
      }
    }
  }

  onremovemessages(ids) {
    ids = new Set(ids);
    if (this.restoring) {
      this.restoring = this.restoring.filter(m => !ids.has(m.id));
    }
    const mod = registry.chatbox.role === "mod";
    const collected = new Map();
    for (const m of this.msgs) {
      if (!ids.has(m.id)) {
        continue;
      }
      if (mod) {
        m.channel = "Removed";
      }
      else {
        Object.assign(m, {
          highlight: false,
          me: false,
          notify: false,
          user: "System",
          role: "system",
          msg: [{
            t: "t",
            v: "Message removed"
          }]
        });
        delete m.channel;
      }
      collected.set(m.id, m);
    }
    this._save();

    let replaced = false;
    const end = this.isScrollEnd;
    for (const list of [this.queue, this.els]) {
      for (let i = 0; i < list.length; ++i) {
        const el = list[i];
        const m = collected.get(el.dataset.id);
        if (!m) {
          continue;
        }
        const [newEl] = this.translateMessage(m);
        if (el.parentElement) {
          el.parentElement.replaceChild(newEl, el);
          replaced = true;
        }
        list[i] = newEl;
      }
    }
    if (replaced && end) {
      // nasty but meh
      setTimeout(() => this.scrollEnd(), 10);
    }
  }

  get isScrollEnd() {
    const {el} = this;
    const end = el.scrollHeight -
          el.clientHeight -
          el.scrollTop;
    return (end < 16);
  }

  flush() {
    const {el} = this;
    const end = this.isScrollEnd;
    for (const e of this.queue) {
      this.els.push(e);
      el.appendChild(e);
    }
    this.queue.length = 0;
    while (this.els.length > 300) {
      const rem = this.els.shift();
      rem.parentElement.removeChild(rem);
    }
    if (end) {
      // nasty but meh
      setTimeout(() => this.scrollEnd(), 10);
    }
    else {
      this.showEndMarker();
    }

    this.flushing = null;
  }

  scrollEnd() {
    if (!this.els.length) {
      return;
    }
    this.els[this.els.length - 1].scrollIntoView();
    this.hideEndMarker();
  }

  showMOTD() {
    const {motd} = registry.roomie;
    if (!motd || !motd.length) {
      return;
    }
    this.add({
      volatile: true,
      role: "system",
      user: "MOTD",
      msg: motd
    });
  }

  showEndMarker() {
    this.endMarker.classList.remove("hidden");
  }

  hideEndMarker() {
    this.endMarker.classList.add("hidden");
  }

  addWelcome() {
    const tpl = document.querySelector("#welcome").content.cloneNode(true);
    const link = tpl.querySelector(".welcome_link");
    const u = new URL(location.pathname, location.href);
    link.textContent = u.href;
    const ttl = tpl.querySelector(".welcome_ttl");
    ttl.textContent = registry.config.get("ttl");
    const copy = tpl.querySelector(".welcome_copy");
    copy.addEventListener("click", e => {
      try {
        e.preventDefault();
        e.stopPropagation();
        const i = dom("input", {attrs: {type: "text"}});
        i.value = u.href;
        copy.appendChild(i);
        i.select();
        document.execCommand("copy");
        copy.removeChild(i);
        copy.classList.add("copied");
        setTimeout(() => copy.classList.remove("copied"), 2000);
      }
      catch (ex) {
        console.error(ex);
      }
    });
    this.add({
      raw: true,
      volatile: true,
      highlight: false,
      notify: false,
      role: "system",
      user: "System",
      msg: [
        {t: "raw", h: tpl.firstElementChild}
      ]
    });
  }

  addSystemMessage(msg) {
    this.add({
      volatile: true,
      user: "System",
      role: "system",
      msg
    });
  }

  async restore() {
    const stored = await this.store.getItem(registry.roomid);
    const {restoring} = this;
    this.restoring = null;
    if (stored) {
      stored.forEach(this.add.bind(this));
    }
    else if (registry.config.has("name")) {
      this.addWelcome();
    }
    else {
      await new Promise(r => registry.config.on("change-name", r));
      this.addWelcome();
    }
    this.queue.push(dom("div", {classes: ["hr"]}));
    restoring.forEach(this.add.bind(this));
  }
}();
