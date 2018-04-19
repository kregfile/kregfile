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

export class Rect {
  constructor(left = 0, top = 0, right = 0, bottom = 0, width = 0, height = 0) {
    this.left = left || 0;
    this.top = top || 0;
    if (width) {
      this.width = width;
    }
    else {
      this.right = right || 0;
    }
    if (height) {
      this.height = height;
    }
    else {
      this.bottom = bottom || 0;
    }
  }

  get width() {
    return this.right - this.left + 1;
  }

  set width(nv) {
    this.right = this.left + nv - 1;
  }

  get height() {
    return this.bottom - this.top + 1;
  }

  set height(nv) {
    this.bottom = this.top + nv - 1;
  }

  expand(dim) {
    this.left -= dim;
    this.right += dim;
    this.top -= dim;
    this.right -= dim;
  }

  move(x, y) {
    this.right = this.left + x;
    this.left = x;
    this.bottom = this.top + x;
    this.top = y;
  }

  offset(x, y) {
    this.left += x;
    this.right += x;
    this.top += y;
    this.bottom += y;
  }
}

export * from "../common/index";
