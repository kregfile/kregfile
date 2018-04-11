"use strict";

const EventEmitter = require("events");
const localforage = require("localforage");
const {debounce} = require("./util");
const {APOOL} = require("./animationpool");
const registry = require("./registry");

class Messages extends EventEmitter {
  constructor() {
    super();
    this.roomid = registry.roomid;
    this.el = document.querySelector("#chat");
    this.endMarker = document.querySelector("#endmarker");
    this.msgs = [];
    this.els = [];
    this.queue = [];
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
    this.store.setItem(this.roomid, this.msgs).
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
    const d = m.date.toLocaleString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const e = document.createElement("div");
    if (m.highlight) {
      e.classList.add("hi");
    }
    const user = document.createElement("span");
    user.classList.add("u");
    if (m.role) {
      user.classList.add(m.role);
    }
    user.textContent = `${m.user}:`;
    const ts = document.createElement("span");
    ts.classList.add("time");
    ts.textContent = d;
    ts.setAttribute("title", m.date.toLocaleString("eu"));
    user.insertBefore(ts, user.firstChild);
    const msg = document.createElement("span");
    msg.classList.add("msg");
    if (!Array.isArray(m.msg)) {
      m.msg = [{t: "t", v: m.msg}];
    }
    for (const p of m.msg) {
      switch (p.t) {
      case "b":
        msg.appendChild(document.createElement("br"));
        break;

      case "u": {
        const a = document.createElement("a");
        a.rel = "nofollow,noopener,noreferrer";
        a.href = p.v;
        a.target = "_blank";
        a.textContent = p.v.replace(/^https?:\/\//, "");
        msg.appendChild(a);
        break;
      }

      case "r": {
        const a = document.createElement("a");
        a.href = `/r/${p.v}`;
        a.target = "_blank";
        a.textContent = `#${p.v}`;
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

  showEndMarker() {
    this.endMarker.classList.remove("hidden");
  }

  hideEndMarker() {
    this.endMarker.classList.add("hidden");
  }

  async restore() {
    const stored = await this.store.getItem(this.roomid);
    const {restoring} = this;
    this.restoring = null;
    if (stored) {
      stored.forEach(this.add.bind(this));
    }
    const hr = document.createElement("div");
    hr.classList.add("hr");
    this.queue.push(hr);
    restoring.forEach(this.add.bind(this));
  }
}

registry.messages = new Messages();
