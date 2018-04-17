"use strict";

export function dom(type, options) {
  const {attrs = {}, text = "", classes = []} = options || {};
  const el = document.createElement(type);
  for (const [an, av] of Object.entries(attrs)) {
    el.setAttribute(an, av);
  }
  if (Array.isArray(classes) && classes.length) {
    el.classList.add(...classes);
  }
  if (text) {
    el.textContent = text;
  }
  return el;
}

export function nukeEvent(e) {
  e.preventDefault();
  e.stopPropagation();
  return false;
}

export * from "../common/index";
