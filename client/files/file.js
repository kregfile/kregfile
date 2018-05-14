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

    this.tagsEl = dom("span", {classes: ["tags"]});
    this.el.appendChild(this.tagsEl);
    this.setupTags();

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

  update(file) {
    super.update(file);
    if (!this.el) {
      return;
    }
    this.setupTags();
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
    const assets = Array.from(this.assets.values()).filter(e => {
      if (e.type !== "image") {
        return false;
      }
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
    sort(assets, sorter);
    const img = this.href + assets.pop().ext;
    const infos = [toPrettySize(this.size), this.tags.user];
    const {resolution, duration} = this;
    if (duration) {
      infos.unshift(duration);
    }
    if (resolution) {
      infos.unshift(resolution);
    }
    return {
      img,
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
