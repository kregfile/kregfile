"use strict";

import {ObservableMap} from "./util";
import registry from "./registry";

export default new class Config extends ObservableMap {
  init() {
    registry.socket.on("config", arr => {
      const cmap = new Map(arr);
      for (const [k, v] of cmap.entries()) {
        if (v === null) {
          this.delete(k);
        }
        else {
          this.set(k, v);
        }
      }
    });
  }
}();
