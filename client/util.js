"use strict";

function nukeEvent(e) {
  e.preventDefault();
  e.stopPropagation();
  return false;
}

module.exports = {
  nukeEvent,
};
Object.assign(module.exports, require("../common"));
