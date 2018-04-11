"use strict";

function debounce(fn, to) {
  if (fn.length) {
    throw new Error("cannot have params");
  }
  to = to || 100;
  let timer;

  const run = function() {
    timer = 0;
    fn();
  };

  return function() {
    if (timer) {
      return;
    }
    timer = setTimeout(run, to);
  };
}

function parseCommand(str) {
  if (str[0] !== "/" || str[1] === "/") {
    return null;
  }

  const idx = str.indexOf(" ");
  const found = idx >= 0;
  const [cmd, args] = [
    (found ? str.slice(1, idx) : str.slice(1)).trim().toLowerCase(),
    (found ? str.slice(idx) : "").trim()
  ];
  return {
    cmd,
    args,
    str
  };
}

function mixin(obj, other) {
  for (const o of [other, Object.getPrototypeOf(other)]) {
    if (!o) {
      continue;
    }
    for (const [k, v] of Object.entries(o)) {
      if (typeof v !== "function") {
        continue;
      }
      obj[k] = o[k].bind(other);
    }
  }
}


module.exports = {
  debounce,
  parseCommand,
  mixin,
};
