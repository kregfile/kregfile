"use strict";

import config from "./config";
import socket from "./socket";
import messages from "./messages";
import roomie from "./roomie";
import chatbox from "./chatbox";
import files from "./files";
import reload from "./reload";

export default new class Registry {
  constructor() {
    Object.defineProperty(this, "roomid", {
      value: document.location.pathname.replace(/^\/r\//, ""),
      enumerable: true
    });
  }
  init() {
    delete this.init;
    const components = {
      socket,
      config,
      messages,
      roomie,
      chatbox,
      files,
      reload,
    };
    for (const [k, component] of Object.entries(components)) {
      this[k] = component;
    }
    for (const [k, component] of Object.entries(components)) {
      if (typeof component === "function") {
        this[k] = component();
      }
      if (typeof component.init === "function") {
        component.init();
      }
    }
  }
}();
