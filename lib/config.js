"use strict";

const path = require("path");
const fs = require("fs");

function load(config, path) {
  let c;
  if (path.endsWith(".json")) {
    if (fs.existsSync(path)) {
      try {
        c = JSON.parse(fs.readFileSync(path));
      }
      catch (ex) {
        console.error("Failed to load JSON config:", path.bold, ex);
      }
    }
  }
  else {
    try {
      c = require(path);
      if (!c) {
        throw new Error("Not an object");
      }
    }
    catch (ex) {
      if (ex.code !== "MODULE_NOT_FOUND") {
        console.error(ex);
      }
    }
  }
  if (!c) {
    return;
  }

  for (const [k, v] of Object.entries(c)) {
    config.set(k, v);
  }
}

module.exports = Object.freeze((function() {
  const rv = new Map();
  load(rv, path.join(__dirname, "..", "defaults"));
  const {HOME} = process.env;
  if (HOME) {
    load(rv, path.join(HOME, ".config", "kregfile.json"));
    load(rv, path.join(HOME, ".config", "kregfile"));
  }
  load(rv, path.join(process.cwd(), ".config.json"));
  load(rv, path.join(process.cwd(), ".config"));
  return rv;
})());
