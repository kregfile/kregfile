"use strict";

const roomid = document.location.pathname.replace(/^\/r\//, "");

function init() {
  for (const component of Object.values(module.exports)) {
    if (typeof component.init !== "function") {
      continue;
    }
    component.init();
  }
}

module.exports = {
  init,
  roomid,
};

require("./config");
require("./socket");
require("./messages");
require("./roomie");
require("./chatbox");
