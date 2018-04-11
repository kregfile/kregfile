"use strict";
/* globals io, localforage */

const registry = require("./registry");

registry.init();

addEventListener("DOMContentLoaded", function load() {
  removeEventListener("DOMContentLoaded", load, true);
  registry.messages.restore().catch(console.error);
}, true);
