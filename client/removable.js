"use strict";

import {APOOL} from "./animationpool";

export default class Removable {
  remove() {
    if (!this.el) {
      return;
    }
    try {
      if (this.destroy) {
        this.destroy();
      }
    }
    catch (ex) {
      console.error("Removable destructor failed", ex);
    }
    try {
      if (this.el.parentElement) {
        this.el.parentElement.removeChild(this.el);
      }
    }
    catch (ex) {
      // ignored
    }
  }
}

Removable.prototype.remove = APOOL.wrap(Removable.prototype.remove);
