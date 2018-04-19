"use strict";

import registry from "../registry";
import {
  dom,
  toPrettyDuration,
  toPrettySize,
  sort,
  Rect,
} from "../util";
import {APOOL} from "../animationpool";
import Removable from "./removable";
import {REMOVALS, TTL} from "./tracker";

const BASE_FILE = {
  name: "",
  href: "#",
  tags: {},
  expires: 0,
};

const ICONS = Object.freeze(new Set([
  "video",
  "audio",
  "image",
  "document",
  "archive",
  "file",
]));

const NUM_FORMAT = new Intl.NumberFormat();

const TIPMETA = Object.freeze(["duration", "codec", "bitrate"]);

class Tooltip extends Removable {
  constructor(file) {
    super();
    this.el = dom("div", {classes: ["tooltip", "tooltip-file"]});
    this.el.appendChild(dom("span", {
      classes: ["tooltip-name"],
      text: file.name
    }));

    this.addPreview(file);

    const a = this.addTag.bind(this);
    const {meta = {}} = file;
    if (meta.width && meta.height) {
      a(`${NUM_FORMAT.format(meta.width)} × ${NUM_FORMAT.format(meta.height)}`, "resolution");
    }
    for (const k of TIPMETA) {
      if (!meta[k]) {
        continue;
      }
      a(meta[k], k);
    }

    const diff = Math.max(0, file.ttl);
    a(toPrettySize(file.size), "size");
    a(toPrettyDuration(diff), "expires");
    file.tagsMap.forEach(a);
  }

  findPreview(file) {
    if (!file.assets.size) {
      return null;
    }
    const assets = sort(Array.from(file.assets.values()), f => {
      // Smallest video, then image, then other
      return [f.type, -(f.width * f.height)];
    });
    return assets.pop();
  }

  rremove() {}
  addPreview(file) {
    const preview = this.findPreview(file);
    if (!preview) {
      return;
    }
    const url = file.href + preview.ext;
    switch (preview.type) {
    case "video": {
      const video = dom("video", {
        attrs: {
          autoplay: "true",
          loop: "true",
          preload: "auto",
        },
        classes: ["tooltip-preview"],
      });
      video.appendChild(dom("source", {
        attrs: {
          type: preview.mime,
          src: url
        }
      }));
      this.el.appendChild(video);
      return;
    }

    case "image": {
      const img = new Image();
      img.src = url;
      img.style.width = preview.width;
      img.style.height = preview.height;
      img.setAttribute("alt", `Preview for ${file.name}`);
      img.classList.add("tooltip-preview");
      this.el.appendChild(img);
      return;
    }

    default:
      console.log("No suitable preview available");
      return;
    }
  }

  addTag(value, tag) {
    this.el.appendChild(dom("span", {
      classes: ["tooltip-tag", "tooltip-tag-tag", `tooltip-tag-${tag}`],
      text: tag.replace(/\b\w/g, l => l.toUpperCase()),
    }));
    this.el.appendChild(dom("span", {
      classes: ["tooltip-tag", "tooltip-tag-value", `tooltip-tag-${tag}`],
      text: value.toString().trim()
    }));
  }

  position(x, y) {
    const {width, height} = this.el.getBoundingClientRect();
    const {innerWidth, innerHeight} = window;
    const client = new Rect(x, y, 0, 0, width, height);
    const available = new Rect(0, 0, innerWidth, innerHeight);
    const offset = 16;
    if (client.bottom + offset > available.bottom) {
      client.offset(0, -(client.height) - offset);
    }
    else {
      client.offset(0, offset);
    }
    if (client.right + offset > available.right) {
      client.offset(-(client.width) - offset, 0);
    }
    else {
      client.offset(offset, 0);
    }
    if (client.top - offset < available.top) {
      client.top += client.height / 2;
    }
    this.el.style.left = `${client.left}px`;
    this.el.style.top = `${client.top}px`;
  }

  show() {
    this.el.classList.add("visible");
  }
}

export default class File extends Removable {
  constructor(owner, file) {
    super();
    Object.assign(this, BASE_FILE, file);
    this.owner = owner;

    const tagEntries = Array.from(Object.entries(this.tags));
    tagEntries.forEach(e => e[1] = e[1].toString());
    this.tagsMap = new Map(tagEntries);
    tagEntries.forEach(e => e[1] = e[1].toUpperCase());
    this.tagsMapCase = new Map(tagEntries);
    this.tagValues = Array.from(this.tagsMap.values());
    this.tagValuesCase = Array.from(this.tagsMapCase.values());

    this.assets = new Map(this.assets);

    this.el = dom("div", {classes: ["file"]});

    this.url = `${this.href}/${this.name}`;

    if (!ICONS.has(this.type)) {
      this.type = "file";
    }
    this.iconEl = dom("a", {
      attrs: {
        target: "_blank",
        rel: "nofollow,noindex",
        href: this.url
      },
      classes: ["icon", `i-${this.type}`],
    });
    this.el.appendChild(this.iconEl);

    this.nameEl = dom("a", {
      attrs: {
        target: "_blank",
        rel: "nofollow,noindex",
        href: this.url
      },
      classes: ["name"],
      text: this.name}
    );
    this.nameEl.addEventListener("mouseenter", this.onenter.bind(this));
    this.el.appendChild(this.nameEl);

    this.tagsEl = dom("span", {classes: ["tags"]});
    this.el.appendChild(this.tagsEl);
    const tags = sort(Array.from(this.tagsMap.entries()));
    for (const [tn, tv] of tags) {
      const tag = dom("span", {
        attrs: {title: `${tn}: ${tv}`},
        classes: ["tag", `tag-${tn}`],
        text: tv}
      );
      tag.dataset.tag = tn;
      tag.dataset.tagValue = tv;
      this.tagsEl.appendChild(tag);
    }

    this.detailEl = dom("span", {classes: ["detail"]});
    this.el.appendChild(this.detailEl);

    this.sizeEl = dom("span", {
      classes: ["size"],
      text: toPrettySize(file.size)
    });
    this.detailEl.appendChild(this.sizeEl);

    this.ttlEl = dom("span", {
      classes: ["ttl"],
      text: "ttl",
    });
    this._updateTTL();
    TTL.add(this);

    this.ttlEl.insertBefore(
      dom("span", {classes: ["i-clock"]}), this.ttlEl.firstChild);
    this.detailEl.appendChild(this.ttlEl);
  }

  get ttl() {
    return registry.roomie.diffTimes(this.expires);
  }

  get expired() {
    return this.ttl <= 0;
  }

  onenter() {
    this.owner.onenter(this);
  }

  generateTooltip() {
    return new Tooltip(this);
  }

  _updateTTL() {
    const diff = Math.max(0, this.ttl);
    this.ttlEl.lastChild.textContent = toPrettyDuration(diff, true);
  }

  update(other) {
    this.assets = new Map(other.assets);
  }

  remove() {
    TTL.delete(this);
    REMOVALS.add(this);
    super.remove();
  }
}

File.prototype.updateTTL = APOOL.wrap(File.prototype._updateTTL);
