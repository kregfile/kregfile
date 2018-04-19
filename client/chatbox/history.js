"use strict";

import localforage from "localforage";
import registry from "../registry";
import {debounce, nukeEvent} from "../util";

export default class History {
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
    const {key, shiftKey} = e;
    if (key !== "ArrowUp" && key !== "ArrowDown") {
      this.hot = false;
      return true;
    }
    if (!this.hot && this.text.value && !shiftKey) {
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
    if (key === "ArrowUp") {
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
