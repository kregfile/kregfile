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

function nukeEvent(e) {
  e.preventDefault();
  e.stopPropagation();
  return false;
}

module.exports = {
  debounce,
  nukeEvent,
};
