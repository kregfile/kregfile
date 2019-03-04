"use strict";

import registry from "client/registry";
registry.init().catch(console.error);

addEventListener("DOMContentLoaded", function load() {
  registry.messages.restore().catch(console.error);
}, {capture: true, once: true});
