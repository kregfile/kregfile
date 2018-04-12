"use strict";

import EventEmitter from "events";
import localforage from "localforage";
import {debounce, nukeEvent, parseCommand} from "./util";
import registry from "./registry";

const RE_WORD = /^[\w\d]$/;

class History {
  constructor(text) {
    this.text = text;
    this.hot = false;
    this.idx = -1;
    this.set = new Set();
    this.arr = [];
    this.store = localforage.createInstance({
      storeName: "chatbox"
    });
    this.store.getItem(registry.roomid).then(m => {
      if (m) {
        this.set = new Set(m);
        this.arr = m;
      }
    }).catch(console.error);
    this.text.addEventListener("keydown", this.down.bind(this));
    this._save = debounce(this._save.bind(this));
    Object.seal(this);
  }

  down(e) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
      this.hot = false;
      return true;
    }
    if (!this.hot && this.text.value && !e.shiftKey) {
      return true;
    }
    this.hot = true;
    const {length} = this.arr;
    if (!length) {
      return true;
    }
    let {idx} = this;
    if (idx < 0) {
      idx = length;
    }
    if (e.key === "ArrowUp") {
      --idx;
    }
    else {
      ++idx;
    }
    if (idx >= length || idx < 0) {
      this.text.value = "";
      this.idx = -1;
    }
    else {
      this.text.value = this.arr[this.idx = idx];
    }
    nukeEvent(e);
    return false;
  }

  add(m) {
    this.set.delete(m);
    this.set.add(m);
    this._save();
  }

  _save() {
    this.store.setItem(registry.roomid, this.arr = Array.from(this.set)).
      catch(console.error);
    this.idx = -1;
  }
}

class Autocomplete {
  constructor(text) {
    this.hot = null;
    this.text = text;
    this.completes = [];
    this.text.addEventListener("keydown", this.down.bind(this));
  }
  add(m) {
    const {user} = m;
    const {completes} = this;
    if (!user) {
      return;
    }
    const uuser = user.toUpperCase();
    const idx = completes.findIndex(e => e.toUpperCase() === uuser);
    if (idx >= 0) {
      completes.splice(idx, 1);
    }
    completes.unshift(user);
    if (completes.length > 20) {
      completes.pop();
    }
  }

  down(e) {
    if (e.key !== "Tab") {
      this.hot = null;
      return true;
    }
    nukeEvent(e);
    const {value} = this.text;
    if (!this.hot) {
      const {selectionStart: cur} = this.text;
      let start = cur - 1;
      while (start >= 0 && (!value[start] || RE_WORD.test(value[start]))) {
        start--;
      }
      ++start;
      const plain = value.slice(start, cur);
      const word = plain.toUpperCase();
      let cands = this.completes.filter(
        e => e.toUpperCase().startsWith(word));
      const post = value.slice(cur);
      if (post && post[0] !== " " && post[0] !== "\n") {
        cands = cands.map(e => `${e} `);
      }
      cands.push(plain);
      this.hot = {
        start,
        pre: value.slice(0, start),
        post,
        word,
        cands,
        remaining: cands.slice()
      };
    }
    const {hot} = this;
    if (!hot.cands.length) {
      return false;
    }
    if (!hot.remaining.length) {
      hot.remaining = hot.cands.slice();
    }
    const cand = hot.remaining.shift();
    const nvalue = hot.pre + cand + hot.post;
    this.text.value = nvalue;
    this.text.selectionEnd = this.text.selectionStart =
      hot.start + cand.length;
    return false;
  }
}

export default new class ChatBox extends EventEmitter {
  constructor() {
    super();
    this.currentNick = "";
    this.text = document.querySelector("#text");
    this.nick = document.querySelector("#nick");
    this.history = null;
    this.autocomplete = new Autocomplete(this.text);
    this.text.addEventListener("keypress", this.press.bind(this));
    Object.seal(this);
  }

  init() {
    this.history = new History(this.text);

    registry.messages.on("message", m => {
      this.autocomplete.add(m);
    });

    registry.socket.on("nick", m => {
      this.nick.value = m;
      this.currentNick = m;
      localStorage.setItem("nick", m);
    });
  }

  press(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      const {target} = e;
      if (target.value) {
        let {value} = target;
        value = value.trim();
        const cmd = parseCommand(value);
        if (cmd && this.doCommand(cmd)) {
          // done
        }
        else {
          this.sendMessage(value);
        }
        target.value = "";
      }
      return nukeEvent(e);
    }
    return true;
  }

  cmd_nick(value) {
    this.nick.value = value;
    this.ensureNick();
    return true;
  }

  doCommand(cmd) {
    const fn = this[`cmd_${cmd.cmd}`];
    if (!fn) {
      return false;
    }
    if (fn.call(this, cmd.args)) {
      this.history.add(cmd.str);
      return true;
    }
    return false;
  }

  ensureNick() {
    try {
      const {value: onick} = this.nick;
      if (onick.length <= 3) {
        this.emit("error", "Nickname too short");
        return;
      }
      if (onick.length > 20) {
        this.emit("error", "Nickname too long");
        return;
      }
      let nick = onick;
      const oldnick = localStorage.getItem("nick");
      if (oldnick === nick) {
        return;
      }
      nick = nick.replace(/[^a-z\d]/gi, "");
      if (onick !== nick) {
        this.emit(
          "warn",
          "Nickname contained invalid stuff, which was removed");
      }
      if (nick.length <= 3) {
        this.emit("error", "Nickname too short");
        return;
      }
      if (nick.length > 20) {
        this.emit("error", "Nickname too long");
        return;
      }
      registry.socket.emit("nick", nick);
      localStorage.setItem("nick", nick);
    }
    finally {
      this.currentNick = this.nick.value = localStorage.getItem("nick");
    }
  }

  sendMessage(m) {
    this.ensureNick();
    registry.socket.emit("message", m);
    this.history.add(m);
  }

  checkHighlight(str) {
    return str.toUpperCase().includes(this.currentNick.toUpperCase());
  }
}();
