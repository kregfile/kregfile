"use strict";

function *_iter(list, dir, from) {
  if (typeof from === "undefined") {
    if (dir > 0) {
      from = 0;
    }
    else {
      from = list.length - 1;
    }
  }
  if (typeof from !== "number" || !isFinite(from)) {
    console.log(from, typeof from);
    throw new Error("Invalid from");
  }
  const to = list.length;
  for (let i = 0; i < to; i++) {
    if (from < 0) {
      from = to - 1;
    }
    if (from >= to) {
      from = 0;
    }
    if (from < 0 || from >= list.length || to !== list.length) {
      console.log(from, to, list.length);
      throw new Error("Invalid iterator state; list might have been mutated");
    }
    yield list[from];
    from += dir;
  }
}

function iter(list, from) {
  return _iter(list, 1, from);
}

function riter(list, from) {
  return _iter(list, -1, from);
}

module.exports = { iter, riter };
