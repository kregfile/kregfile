"use strict";

import message from "../common/message";

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

const TYPES = Object.freeze(new Set([
  "video",
  "audio",
  "image",
  "document",
  "archive",
  "file",
]));

export function toType(type) {
  return TYPES.has(type) && type || "file";
}

export function validateUsername(nick) {
  if (nick.length < 3) {
    throw new Error("User name too short");
  }
  if (nick.length > 20) {
    throw new Error("User name too long");
  }
  nick = nick.replace(/[^a-z\d]/gi, "");
  if (nick.length < 3) {
    throw new Error("User name too short");
  }
  return nick;
}

export function formToJSON(data) {
  const rv = {};
  for (const [key, value] of data.entries()) {
    rv[key] = value;
  }
  return JSON.stringify(rv);
}

export function openInNew(href) {
  const link = dom("a", {attrs: {
    style: "display: none;",
    href,
    target: "_blank",
  }});
  document.body.appendChild(link);
  try {
    link.click();
  }
  finally {
    document.body.removeChild(link);
  }
}

export function idle(fn, timeout) {
  if (!window.requestIdleCallback) {
    return function(...args) {
      try {
        return Promise.resolve(fn.apply(this, args));
      }
      catch (ex) {
        return Promise.reject(ex);
      }
    };
  }

  return function idleWrapped(...args) {
    const self = this;
    return new Promise((resolve, reject) => {
      const wrapped = function() {
        try {
          resolve(fn.apply(self, args));
        }
        catch (ex) {
          reject(ex);
        }
      };
      if (timeout) {
        requestIdleCallback(wrapped, {timeout});
      }
      else {
        requestIdleCallback(wrapped);
      }
    });
  };
}

function resolveRoom(v) {
  return {v};
}

function resolveFile(v) {
  return {
    key: v,
    name: "Some file",
    type: "file",
    href: `/g/${v}`,
    client: true
  };
}

export const normalizeURL = message.normalizeURL.bind(null, URL);
export const toMessage = message.toMessage.bind(
  null, URL, resolveRoom, resolveFile);

export function roleToIcon(role) {
  switch (role) {
  case "system":
    return "i-sytem32";

  case "mod":
    return "i-purple";

  case "user":
    return "i-green";
  default:
    return "i-white";
  }
}

export * from "../common/index";
