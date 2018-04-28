"use strict";

import {nukeEvent} from "../util";

const RE_WORD = /^[\w\d]$/;

export default class Autocomplete {
  constructor(owner) {
    this.hot = null;
    this.owner = owner;
    this.text = owner.text;
    this.completes = [];
    this.text.addEventListener("keydown", this.down.bind(this));
  }

  add(m) {
    const {user, role} = m;
    const {completes} = this;
    if (!user || role === "system") {
      return;
    }
    const uuser = user.toUpperCase();
    if (uuser === this.owner.currentNick) {
      return;
    }
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
