"use strict";

export function nukeEvent(e) {
  e.preventDefault();
  e.stopPropagation();
  return false;
}

export * from "../lib/common";
