"use strict";

import registry from "client/registry";
registry.init();

addEventListener("DOMContentLoaded", function load() {
  removeEventListener("DOMContentLoaded", load, true);
  registry.messages.restore().catch(console.error);
}, true);
