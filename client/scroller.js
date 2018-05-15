"use strict";

import {dom, debounce, nukeEvent} from "./util";
import {APOOL} from "./animationpool";

export default class Scroller {
  constructor(el, scroller) {
    this.el = el;
    this.scroller = scroller;
    this.updating = null;
    this.start = 0;
    this.off = 0;

    el.addEventListener("wheel", () => {}, { passive: true });

    const diff = el.clientWidth - el.offsetWidth;
    if (!diff) {
      el.addEventListener("scroll", () => {}, { passive: true });
      // no need to do anything, aka macos and some gtk themes
      Object.seal(this);
      return;
    }

    this.adjustBar = APOOL.wrap(this.adjustBar);
    this.update = debounce(this.update);

    this.onmouseup = this.onmouseup.bind(this);
    this.onmousemove = this.onmousemove.bind(this);

    this.bar = dom("div", {
      classes: ["scrollbar"],
    });
    scroller.appendChild(this.bar);
    this.bar.addEventListener("mousedown", this.onmousedown.bind(this));

    // hide the platform scroll bar
    el.style.marginRight = `${diff - 2}px`;
    el.addEventListener("scroll", this.onscroll.bind(this), { passive: true });
    addEventListener("resize", this.onresize.bind(this), { passive: true });

    this.obs = new MutationObserver(this.onmutate.bind(this));
    this.obs.observe(el, {
      childList: true,
    });

    Object.seal(this);

    this.adjustBar();
  }

  adjustBar() {
    // calc visible fraction
    const {el, scroller, bar} = this;
    const {scrollTop, scrollHeight, clientHeight} = el;
    let visible = clientHeight / scrollHeight;
    if (visible === 1) {
      scroller.classList.add("hidden");
      return;
    }

    if (clientHeight > 40) {
      const frac = 40 / clientHeight;
      visible = Math.max(frac, visible);
    }
    else {
      visible = Math.max(0.25, visible);
    }
    const ivisible = 1 - visible;

    bar.style.height = `${visible * 100}%`;

    const top = (scrollTop / (scrollHeight - clientHeight));

    bar.style.top = `${top * ivisible * 100}%`;

    scroller.classList.remove("hidden");
  }

  update() {
    if (this.updating) {
      return;
    }
    this.updating = this.adjustBar().then(() => {
      this.updating = null;
    });
  }

  onscroll() {
    this.update();
  }

  onresize() {
    this.update();
  }

  onmutate() {
    this.update();
  }

  onmousedown(e) {
    this.start = e.pageY;
    this.off = this.bar.offsetTop;
    addEventListener("mouseup", this.onmouseup);
    addEventListener("mousemove", this.onmousemove, { passive: true });
    nukeEvent(e);
  }

  onmouseup() {
    removeEventListener("mouseup", this.onmouseup);
    removeEventListener("mousemove", this.onmousemove, { passive: true });
  }

  onmousemove(e) {
    const {off, start, el, bar} = this;
    const {scrollHeight, clientHeight} = el;
    const max = clientHeight - bar.clientHeight;
    const newPos = Math.max(
      0, Math.min(max, off - start + e.pageY)
    ) / max;
    const newTop = (scrollHeight - clientHeight) * newPos;
    el.scrollTop = newTop;
    nukeEvent(e);
  }
}
