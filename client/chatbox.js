"use strict";

import EventEmitter from "events";
import {nukeEvent, parseCommand, validateUsername} from "./util";
import registry from "./registry";
import History from "./chatbox/history";
import Autocomplete from "./chatbox/autocomplete";
import {convertMessage, WHITE} from "./chatbox/parse";

export default new class ChatBox extends EventEmitter {
  constructor() {
    super();
    this.currentNick = "";
    this.text = document.querySelector("#text");
    this.nick = document.querySelector("#nick");
    this.icon = document.querySelector("#user-icon");
    this.authed = "";
    this.history = null;
    this.autocomplete = new Autocomplete(this);
    this.text.addEventListener("keypress", this.onpress.bind(this));
    this.text.addEventListener("paste", this.onpaste.bind(this));
    this.text.addEventListener("drop", this.ondrop.bind(this));
    Object.seal(this);
  }

  init() {
    this.history = new History(this.text);

    registry.messages.on("message", m => {
      this.autocomplete.add(m);
    });

    registry.socket.on("role", m => {
      this.icon.className = "";
      this.icon.classList.add(m);
      switch (m) {
      case "user":
        this.icon.classList.add("i-green");
        break;

      case "mod":
        this.icon.classList.add("i-purple");
        break;
      default:
        this.icon.classList.add("i-white");
        break;
      }
    });

    registry.socket.on("nick", m => {
      this.setNick(m);
    });

    registry.socket.on("authed", authed => {
      this.authed = authed;
      if (this.authed) {
        this.ensureNick(true);
      }
    });
  }

  onpress(e) {
    const {key, shiftKey} = e;
    if (key === "Enter" && !shiftKey) {
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
    if (this.text.value.length >= 300) {
      return nukeEvent(e);
    }
    if (key === " " || key === "Enter") {
      this.reparse(key === "Enter" ? "\n" : " ");
      return nukeEvent(e);
    }
    return true;
  }

  reparse(additional) {
    const {selectionStart: start, selectionEnd: end, value} = this.text;
    const pre = value.slice(0, start);
    const post = value.slice(end);
    const cpre = convertMessage(pre);
    const cpost = convertMessage(post);
    const nm = cpre + additional + cpost;
    this.text.value = nm.slice(0, 300);
    this.text.selectionEnd = this.text.selectionStart = Math.min(
      cpre.length + 1, this.text.value.length);
  }

  injectFromEvent(data) {
    data = convertMessage(data);
    if (!data) {
      return;
    }
    const {selectionStart: start, selectionEnd: end, value} = this.text;
    const pre = value.slice(0, start);
    const post = value.slice(end);
    data = (pre && !WHITE.test(pre.slice(-1)) ? " " : "") +
      data +
      (!post || !WHITE.test(post[0]) ? " " : "");
    const nm = pre + data + post;
    if (nm.length > 300) {
      return;
    }
    this.text.value = nm;
    this.text.selectionEnd = this.text.selectionStart = start + data.length;
  }

  onpaste(e) {
    let data = e.clipboardData || window.clipboardData;
    if (!data) {
      return;
    }
    data = data.getData("text") || data.getData("text/plain");
    if (!data) {
      return;
    }
    nukeEvent(e);
    this.injectFromEvent(data);
  }

  ondrop() {
    setTimeout(() => {
      this.text.selectionStart = this.text.selectionEnd;
      this.reparse(" ");
      this.text.focus();
    });
  }

  cmd_nick(value) {
    this.nick.value = value;
    this.ensureNick();
    return true;
  }

  cmd_motd() {
    registry.messages.showMOTD();
    return true;
  }

  cmd_search(value) {
    registry.files.setFilter(value);
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

  ensureNick(silent) {
    try {
      let {value: onick} = this.nick;
      if (!onick) {
        onick = localStorage.getItem("nick");
      }
      let nick;
      if (this.authed) {
        nick = onick.toLowerCase() === this.authed ? onick : this.authed;
      }
      else {
        nick = validateUsername(onick);
      }
      const oldnick = localStorage.getItem("nick");
      localStorage.setItem("nick", nick);
      if (onick !== nick && !silent) {
        this.emit(
          "warn",
          "User name contained invalid stuff, which was removed");
      }
      if (oldnick === nick) {
        return;
      }
      registry.socket.emit("nick", nick);
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
    if (!this.currentNick) {
      return false;
    }
    return str.toUpperCase().includes(this.currentNick.toUpperCase());
  }

  setNick(nick) {
    this.nick.value = nick;
    this.currentNick = nick;
    localStorage.setItem("nick", nick);
  }
}();
