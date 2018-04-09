"use strict";
/* global localforage */

const EventEmitter = require("events");
const {debounce} = require("./util");
const {APOOL} = require("./animationpool");

class Messages extends EventEmitter {
  constructor(roomid) {
    super();
    this.roomid = roomid;
    this.el = document.querySelector("#chat");
    this.msgs = [];
    this.store = localforage.createInstance({
      storeName: "msgs"
    });
    this._save = debounce(this._save.bind(this));
    this.flush = APOOL.wrap(this.flush);
    Object.seal(this);
  }

  _save() {
    this.store.setItem(this.roomid, this.msgs).
      catch(console.error);
  }

  _add(m) {
    m.date = m.date || new Date();
    if (m.volatile) {
      return;
    }
    this.msgs.push(m);
    if (this.msgs.length > 100) {
      this.msgs.shift();
    }
    this._save();
    this.emit("message", m);
  }

  add(m) {
    this._add(m);
    const d = m.date.toLocaleString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const e = document.createElement("div");
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
        a.href = `/${p.v}`;
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

    this.flush(e);
  }

  flush(e) {
    const {el} = this;
    const end = el.scrollHeight -
        el.clientHeight -
        el.scrollTop;
    el.appendChild(e);
    if (end < 10) {
      e.scrollIntoView();
    }
  }

  async restore() {
    const stored = (await this.store.getItem(this.roomid));
    if (stored) {
      stored.forEach(this.add.bind(this));
    }
  }
}

module.exports = {Messages};
