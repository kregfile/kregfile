"use strict";

import Tooltip from "./tooltip";
import Removable from "./removable";
import registry from "./registry";
import {
  dom,
  toPrettyDuration,
  toPrettyInt,
  toPrettySize,
  sort,
  Rect,
  toType,
} from "./util";

const BASE_FILE = {
  name: "",
  href: "#",
  tags: {},
  expires: 0,
};

const TIPMETA = Object.freeze(["duration", "codec", "bitrate"]);

const NUM_FORMAT = new Intl.NumberFormat();

class FileTooltip extends Tooltip {
  constructor(file) {
    super(file.name);
    this.file = file;
    this.el.classList.add("tooltip-file");

    this.addPreview(file);

    const a = this.addTag.bind(this);
    const {meta = {}, resolution} = file;
    if (resolution) {
      a(resolution, "resolution");
    }
    for (const k of TIPMETA) {
      if (!meta[k]) {
        continue;
      }
      a(meta[k], k);
    }

    const diff = Math.max(0, file.ttl);
    a(toPrettySize(file.size), "size");
    a(`(${toPrettyInt(file.size)} Bytes)`, "");
    a(new Date(Date.now() + diff).toLocaleString(), "expires");
    a(toPrettyDuration(diff), "");
    if (file.uploaded) {
      a(file.localUploaded.toLocaleString(), "uploaded");
      const since = Date.now() - file.localUploaded;
      a(`${toPrettyDuration(since)} ago`, "");
    }
    file.tagsMap.forEach(a);
  }

  addPreview(file) {
    const preview = file.findPreview();
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
      this.video = video;
      return;
    }

    case "image": {
      const img = new Image();
      img.src = "/loader.png";
      img.style.width = preview.width;
      img.style.height = preview.height;
      img.setAttribute("alt", `Preview for ${file.name}`);
      img.classList.add("tooltip-preview");
      const loaded = img.cloneNode();
      loaded.onload = () => {
        if (!img.parentElement) {
          // Might have been removed already
          return;
        }
        img.parentElement.replaceChild(loaded, img);
      };
      loaded.src = url;
      this.el.appendChild(img);
      this.img = img;
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
    const el = dom("span", {
      classes: ["tooltip-tag", "tooltip-tag-value", `tooltip-tag-${tag}`],
      text: value.toString().trim()
    });
    if (tag === "user") {
      el.classList.add("u", this.file.meta.role || "white");
    }
    this.el.appendChild(el);
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

  destroy() {
    if (this.video) {
      this.video.pause();
      this.video.textContent = "";
      this.video.parentElement.removeChild(this.video);
      this.video = null;
    }
    if (this.img) {
      this.img.src = "";
      this.img.srcset = "";
      this.img.parentElement.removeChild(this.img);
    }
  }
}

export default class File extends Removable {
  constructor(file) {
    super();
    Object.assign(this, BASE_FILE);
    this.update(file);
  }

  get ttl() {
    return registry.roomie.diffTimes(this.expires);
  }

  get localUploaded() {
    return new Date(registry.roomie.fromServerTime(this.uploaded));
  }

  get expired() {
    return this.ttl <= 0;
  }

  get resolution() {
    const {meta = {}} = this;
    if (!meta.width && !meta.height) {
      return "";
    }
    return `${NUM_FORMAT.format(meta.width)} × ${NUM_FORMAT.format(meta.height)}`;
  }

  get duration() {
    const {meta = {}} = this;
    return meta.duration || "";
  }

  update(other) {
    Object.assign(this, other);

    if (this.ip) {
      this.tags.ip = this.ip;
    }

    const tagEntries = Array.from(Object.entries(this.tags));
    tagEntries.forEach(e => e[1] = e[1].toString());
    this.tagsMap = new Map(tagEntries);
    tagEntries.forEach(e => e[1] = e[1].toUpperCase());
    this.tagsMapCase = new Map(tagEntries);
    this.tagValues = Array.from(this.tagsMap.values());
    this.tagValuesCase = Array.from(this.tagsMapCase.values());

    this.assets = new Map(this.assets);
    this.type = toType(this.type);
    const url = new URL(this.href, document.location);
    url.pathname += `/${this.name}`;
    this.url = url.href;
  }

  generateTooltip() {
    return new FileTooltip(this);
  }

  showTooltip(e) {
    const tt = this.generateTooltip();
    if (!tt) {
      return;
    }
    registry.roomie.installTooltip(tt, e);
  }

  findPreview() {
    if (!this.assets || !this.assets.size) {
      return null;
    }
    const assets = sort(Array.from(this.assets.values()), f => {
      // Smallest video, then image, then other
      return [f.type, -(f.width * f.height)];
    });
    return assets.pop();
  }
}
