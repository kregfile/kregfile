"use strict";

import EventEmitter from "events";
import localforage from "localforage";
import {dom, debounce} from "./util";
import {APOOL} from "./animationpool";
import registry from "./registry";

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
    this.el = document.querySelector("#chat");
    this.endMarker = document.querySelector("#endmarker");
    this.msgs = [];
    this.els = [];
    this.queue = [];
    this.fileInfos = new WeakMap();
    this.flushing = null;
    this.store = localforage.createInstance({
      storeName: "msgs"
    });
    this._save = debounce(this._save.bind(this));
    this.flush = APOOL.wrap(this.flush);
    this.scrollEnd = APOOL.wrap(this.scrollEnd);
    this.restoring = [];

    Object.seal(this);
  }

  init() {
    registry.socket.on("message", this.add.bind(this));

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

    this.endMarker.addEventListener("click", () => {
      this.scrollEnd();
    });
    this.el.addEventListener("scroll", () => {
      if (this.isScrollEnd) {
        this.hideEndMarker();
      }
    });
  }

  _save() {
    this.store.setItem(registry.roomid, this.msgs).
      catch(console.error);
  }

  _add(m) {
    m.date = m.date || new Date();
    let notify = false;
    if (!("notify" in m)) {
      m.notify = false;
      for (const p of m.msg) {
        if (p.t === "t" && registry.chatbox.checkHighlight(p.v)) {
          notify = true;
          break;
        }
      }
    }
    if (!("highlight" in m)) {
      m.highlight = notify;
    }

    if (m.volatile) {
      return notify;
    }

    this.msgs.push(m);
    if (this.msgs.length > 100) {
      this.msgs.shift();
    }
    this._save();
    this.emit("message", m);
    return notify;
  }

  add(m) {
    if (this.restoring) {
      this.restoring.push(m);
      return;
    }
    const notify = this._add(m);
    const d = DATE_FORMAT_SHORT.format(m.date);

    const e = dom("div");
    if (m.highlight) {
      e.classList.add("hi");
    }
    if (m.me) {
      e.classList.add("me");
    }
    const ucls = ["u"];
    if (m.role) {
      ucls.push(m.role);
    }
    const user = dom("span", {
      classes: ucls,
      text: m.me ? m.user : `${m.user}:`
    });

    const ts = dom("span", {
      attrs: {title: DATE_FORMAT_LONG.format(m.date)},
      classes: ["time"],
      text: d
    });
    user.insertBefore(ts, user.firstChild);

    const msg = dom("span", {
      classes: ["msg"]
    });
    if (!Array.isArray(m.msg)) {
      m.msg = [{t: "t", v: m.msg}];
    }
    for (const p of m.msg) {
      switch (p.t) {
      case "b":
        msg.appendChild(dom("br"));
        break;

      case "f": {
        const file = dom("a", {
          classes: ["chatfile"],
          attrs: {
            target: "_blank",
            rel: "nofollow",
            href: p.href,
          },
          text: p.name
        });
        this.fileInfos.set(file, p);
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
          text: p.v.replace(/^https?:\/\//, ""),
        });
        msg.appendChild(a);
        break;
      }

      case "r": {
        const a = dom("a", {
          attrs: {
            target: "_blank",
            href: `/r/${p.v}`,
          },
          text: `#${p.v}`,
        });
        msg.appendChild(a);
        break;
      }

      default:
        msg.appendChild(document.createTextNode(p.v));
        break;
      }
    }
    e.appendChild(user);
    e.appendChild(msg);

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

  async restore() {
    const stored = await this.store.getItem(registry.roomid);
    const {restoring} = this;
    this.restoring = null;
    if (stored) {
      stored.forEach(this.add.bind(this));
    }
    else {
      this.add({
        volatile: true,
        highlight: true,
        notify: false,
        role: "system",
        user: "System",
        msg: [
          {t: "t", v: "Welcome to kregfile"},
          {t: "b"},
          {t: "t", v: "Share this room with somebody: "},
          {t: "b"},
          {t: "u", v: document.location.href.toString()},
        ]
      });
    }
    this.queue.push(dom("div", {classes: ["hr"]}));
    restoring.forEach(this.add.bind(this));
  }
}();
