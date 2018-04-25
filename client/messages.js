"use strict";

import EventEmitter from "events";
import localforage from "localforage";
import {
  debounce,
  dom,
  nukeEvent,
  toPrettyInt,
  toPrettySize,
  toType,
} from "./util";
import {APOOL} from "./animationpool";
import registry from "./registry";
import Tooltip from "./tooltip";
import File from "./file";
import Scroller from "./scroller";

const DATE_FORMAT_SHORT = new Intl.DateTimeFormat("en-US", {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const DATE_FORMAT_LONG = new Intl.DateTimeFormat("eu");

class UserTooltip extends Tooltip {
  constructor(info) {
    super(info.name);
    this.el.classList.add("tooltip-user");
    if (info.gravatar) {
      this.el.appendChild(dom("img", {
        classes: ["tooltip-preview"],
        attrs: {src: info.gravatar}
      }));
    }
    else {
      this.el.appendChild(dom("span", {
        classes: [
          "tooltip-preview",
          info.role === "mod" ? "i-purple" : "i-green",
          info.role
        ],
      }));
    }

    const add = (t, v) => {
      this.el.appendChild(dom("span", {
        classes: ["tooltip-tag-tag"],
        text: `${t}:`
      }));
      this.el.appendChild(dom("span", {
        classes: ["tooltip-tag-value"],
        text: v
      }));
    };

    switch (info.role) {
    case "mod":
      add("Is a", "Moderator");
      break;

    case "user":
      add("Is a", "User");
      break;
    }
    if (info.email) {
      add("Email", info.email);
    }
    if (info.uploadStats.filesRank) {
      const {uploadStats: s} = info;
      add("Uploaded", `${toPrettySize(s.uploaded)} (#${toPrettyInt(s.uploadedRank)})`);
      add("Files", `${toPrettyInt(s.files)} (#${toPrettyInt(s.filesRank)})`);
    }
    else {
      add("Uploaded", "Nothing 😢");
    }
  }
}

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

  async onfileenter(e) {
    let file = this.files.get(e.target);
    if (!file) {
      return;
    }
    if (file.unknown) {
      registry.roomie.installTooltip(new Tooltip("File unknown"), e);
      return;
    }
    if (!file.url) {
      try {
        file = await registry.socket.makeCall("fileinfo", file.key);
        if (!file) {
          throw Error("no file");
        }
        file.external = true;
        file = new File(file);
        this.files.set(e.target, file);
      }
      catch (ex) {
        file.unknown = true;
        console.error(ex);
        return;
      }
    }
    if (file.expired || file.unknown) {
      registry.roomie.installTooltip(new Tooltip("File unknown"), e);
      return;
    }
    file.showTooltip(e);
  }

  async onuserenter(e) {
    const {profile} = e.target.dataset;
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
    registry.roomie.showMessage("Imma ban u!", "Stub");
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

    if (m.saved) {
      notify = false;
    }

    if (m.volatile) {
      return notify;
    }

    this.emit("message", m);
    m.saved = true;
    this.msgs.push(m);
    if (this.msgs.length > 100) {
      this.msgs.shift();
    }
    this._save();
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
    let user;
    if (m.role && m.role !== "white" && m.role !== "system") {
      const profile = m.user.toLowerCase();
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
      user.addEventListener("mouseenter", this.onuserenter);
    }
    else {
      user = dom("span", {
        classes: ucls,
        text: m.user
      });
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
      user.appendChild(ban);
      ban.onclick = this.onbanclick;
    }

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
            href: `${p.href}/${p.name}`,
          },
          text: p.name
        });
        file.insertBefore(dom("span", {
          classes: ["icon", `i-${toType(p.type)}`],
        }), file.firstChild);
        const info = registry.files.get(p.key) || p;
        this.files.set(file, info);
        file.addEventListener("mouseenter", this.onfileenter);
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

    if (m.channel) {
      e.appendChild(dom("span", {
        classes: ["channel"],
        text: ` (${m.channel})`
      }));
    }

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
