"use strict";

import {
  dom,
  toPrettyDuration,
  toPrettySize,
  sort,
  nukeEvent,
} from "../util";
import {APOOL} from "../animationpool";
import BaseFile from "../file";
import {REMOVALS, TTL} from "./tracker";

const META = Object.freeze(["duration", "codec", "bitrate", "type"]);

export default class File extends BaseFile {
  constructor(owner, file) {
    super(file);
    this.owner = owner;

    this.el = dom("div", {classes: ["file"]});

    this.iconEl = dom("a", {
      attrs: {
        download: this.name,
        rel: "nofollow,noindex",
        href: this.url
      },
      classes: ["icon", `i-${this.type}`],
    });
    this.iconEl.addEventListener("click", this.oniconclick.bind(this));
    this.el.appendChild(this.iconEl);

    this.downloadEl = dom("a", {
      attrs: {
        download: this.name,
        rel: "nofollow,noindex",
        href: this.url
      },
      classes: ["hidden"],
    });
    this.el.appendChild(this.downloadEl);

    this.nameEl = dom("a", {
      attrs: {
        target: "_blank",
        rel: "nofollow,noindex",
        href: this.url
      },
      classes: ["name"],
      text: this.name}
    );
    this.nameEl.addEventListener("mouseenter", this.onenter.bind(this), {
      passive: true
    });
    this.nameEl.addEventListener("click", this.onclick.bind(this));
    this.el.appendChild(this.nameEl);

    this.linkEl = dom("a", {
      attrs: {
        target: "_blank",
        rel: "nofollow,noindex",
        href: this.url
      },
      classes: ["hidden"],
    });
    this.el.appendChild(this.linkEl);

    this.previewContEl = dom("a", {
      attrs: {
        target: "_blank",
        rel: "nofollow,noindex",
        href: this.url
      },
      classes: ["preview", "galleryonly"],
    });
    this.previewContEl.addEventListener("click", this.onclick.bind(this));
    this.previewEl = dom("img", {
      classes: ["loading"],
      attrs: {
        src: "/loader.png"
      }
    });
    this.previewContEl.appendChild(this.previewEl);
    this.el.appendChild(this.previewContEl);

    this.tagsEl = dom("span", {classes: ["tags"]});
    this.el.appendChild(this.tagsEl);
    this.setupTags();

    this.detailEl = dom("span", {classes: ["detail"]});
    this.el.appendChild(this.detailEl);

    const {meta = {}, resolution} = this;
    if (resolution) {
      this.detailEl.appendChild(dom("span", {
        classes: ["galleryonly"],
        text: resolution
      }));
    }
    for (const k of META) {
      if (!meta[k]) {
        continue;
      }
      this.detailEl.appendChild(dom("span", {
        classes: ["galleryonly"],
        text: meta[k]
      }));
    }

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

  adjustPreview() {
    if (!this.previewEl.classList.contains("loading")) {
      return;
    }
    this.previewEl.classList.remove("loading");
    const preview = this.findPreview() || {type: "none"};
    const url = this.href + preview.ext;
    switch (preview.type) {
    case "video": {
      const video = dom("video", {
        attrs: {
          loop: "true",
          preload: "auto",
        },
      });
      video.appendChild(dom("source", {
        attrs: {
          type: preview.mime,
          src: url
        }
      }));
      this.previewContEl.replaceChild(video, this.previewEl);
      this.previewEl = video;
      this.previewContEl.addEventListener("mouseenter", () => {
        video.currentTime = 0;
        video.play();
      }, {passive: true});
      this.previewContEl.addEventListener("mouseleave", () => {
        video.pause();
        video.currentTime = 0;
      }, {passive: true});
      return;
    }

    case "image": {
      const loaded = new Image();
      loaded.onload = () => {
        this.previewContEl.replaceChild(loaded, this.previewEl);
        this.previewEl = loaded;
      };
      loaded.src = url;
      return;
    }

    default: {
      const faticon = dom("span", {
        classes: ["faticon", "icon", `i-${this.type}`],
      });
      this.previewContEl.replaceChild(faticon, this.previewEl);
      this.previewEl = faticon;
      return;
    }
    }
  }

  update(file) {
    super.update(file);
    if (!this.el) {
      return;
    }
    this.setupTags();
    this.previewEl.classList.add("loading");
    if (this.owner.galleryMode) {
      APOOL.schedule(null, () => this.adjustPreview());
    }
  }

  setupTags() {
    const tags = sort(Array.from(this.tagsMap.entries()));
    this.el.classList.remove("hidden-file");
    this.tagsEl.textContent = "";
    for (const [tn, tv] of tags) {
      if (tn === "hidden") {
        if (!tv || tv === "false") {
          continue;
        }
        this.el.classList.add("hidden-file");
      }
      const tag = dom("span", {
        attrs: {title: `${tn}: ${tv}`},
        classes: ["tag", `tag-${tn}`],
        text: tv === "true" || tv === "false" ? tn : tv
      });
      tag.dataset.tag = tn;
      tag.dataset.tagValue = tv;
      this.tagsEl.appendChild(tag);
    }
  }

  onenter(e) {
    this.showTooltip(e);
  }

  onclick(e) {
    try {
      if (e.altKey || e.shiftKey || e.metaKey || e.optionKey) {
        return true;
      }
      if (this.getGalleryInfo()) {
        this.owner.openGallery(this);
        return nukeEvent(e);
      }
    }
    catch (ex) {
      console.error(ex);
    }
    return true;
  }

  oniconclick(e) {
    const {classList} = document.body;
    if (!classList.contains("mod") && !classList.contains("owner")) {
      return;
    }
    nukeEvent(e);
    this.owner.select(this, e);
  }

  open(e) {
    if (e) {
      this.linkEl.dispatchEvent(e);
      return;
    }
    this.linkEl.click();
  }

  download(e) {
    if (e) {
      this.downloadEl.dispatchEvent(e);
      return;
    }
    this.downloadEl.click();
  }

  getGalleryInfo() {
    if (this.type === "audio" || !this.assets.size) {
      return null;
    }
    const {innerWidth, innerHeight} = window;
    const assets = Array.from(this.assets.values()).
      filter(e => e.type === "image");
    sort(assets, e => e.width * e.height);
    const bestAssets = assets.filter(e => {
      if (e.width > innerWidth * 1.4) {
        return false;
      }
      if (e.height > innerHeight * 1.4) {
        return false;
      }
      return true;
    });
    if (!assets.length) {
      return null;
    }
    const sorter = e => {
      return [
        !(Math.abs(e.width - innerWidth) < 100 &&
        Math.abs(e.height - innerHeight) < 100),
        e.width * e.height
      ];
    };
    sort(bestAssets, sorter);
    const img = this.href + bestAssets.pop().ext;
    const infos = [toPrettySize(this.size), this.tags.user];
    const {resolution, duration} = this;
    if (duration) {
      infos.unshift(duration);
    }
    if (resolution) {
      infos.unshift(resolution);
    }
    const srcset = assets.map(e => `${this.href}${e.ext} ${e.width}w`).join(", ");
    const largest = assets.pop();
    const sizes = `${assets.map(e => `(max-width: ${e.width}px) ${e.width}px`).join(", ")}, ${largest.width}px`;
    return {
      img,
      srcset,
      sizes,
      infos
    };
  }

  _updateTTL() {
    const diff = Math.max(0, this.ttl);
    this.ttlEl.lastChild.textContent = toPrettyDuration(diff, true);
  }

  remove() {
    TTL.delete(this);
    REMOVALS.add(this);
    this.owner.maybeCloseGallery(this);
    super.remove();
  }
}

File.prototype.updateTTL = APOOL.wrap(File.prototype._updateTTL);
