"use strict";

import {APOOL} from "../animationpool";

export default class ScrollState {
  constructor(owner) {
    this.owner = owner;
    this.key = null;
    this.diff = 0;
    this.pop = APOOL.wrap(this.pop);

    Object.seal(this);
  }

  maybePush() {
    const {scrollTop} = this.owner.el;
    if (!scrollTop) {
      return;
    }
  }

  push() {
    if (this.key) {
      return;
    }
    const {scrollTop: st, offsetTop: ot} = this.owner.el;
    if (st === 0) {
      return;
    }
    const {visible} = this.owner;
    if (!visible.length) {
      return;
    }

    function calc(file) {
      const {offsetHeight, offsetTop} = file.el;
      const top = offsetTop - ot;
      const bottom = top + offsetHeight;
      const diff = st - bottom;
      return {top, bottom, diff};
    }

    // binary search for intersection element
    let low = 0;
    let high = visible.length - 1;
    while (low <= high) {
      const pivot = ((low + high) / 2) | 0;
      const file = visible[pivot];
      const {top, bottom, diff} = calc(file);
      if (bottom < st) {
        low = pivot + 1;
        continue;
      }
      if (top > st) {
        high = pivot - 1;
        continue;
      }
      this.key = file.key;
      this.diff = diff;
      break;
    }
  }

  pop() {
    if (!this.key) {
      return false;
    }
    const file = this.owner.get(this.key);
    this.key = null;
    if (!file || !file.el || !file.el.parentElement) {
      return false;
    }
    const {scrollTop, offsetTop} = this.owner.el;
    const newScrollTop =
      file.el.offsetTop + file.el.offsetHeight - offsetTop + this.diff;
    if (Math.abs(scrollTop - newScrollTop) > 4) {
      this.owner.el.scrollTop = newScrollTop;
    }
    return true;
  }
}

