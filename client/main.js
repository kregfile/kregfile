"use strict";

import registry from "./registry";
registry.init();

addEventListener("DOMContentLoaded", function load() {
  removeEventListener("DOMContentLoaded", load, true);
  registry.messages.restore().catch(console.error);
}, true);
