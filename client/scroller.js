"use strict";

import {dom, debounce, nukeEvent} from "./util";
import {APOOL} from "./animationPool";

export default class Scroller {
  constructor(el, scroller) {
    this.el = el;
    this.scroller = scroller;
    this.updating = null;
    this.start = 0;
    this.off = 0;
    this.max = 0;

    const diff = el.clientWidth - el.offsetWidth;
    if (!diff) {
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
    el.style.marginRight = `${diff}px`;
    el.addEventListener("scroll", this.onscroll.bind(this));
    addEventListener("resize", this.onresize.bind(this));

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
    const {clientHeight, scrollHeight, scrollTop} = el;
    const visible = clientHeight / scrollHeight;
    if (visible === 1) {
      scroller.classList.add("hidden");
      return;
    }

    bar.style.height = `${visible * 100}%`;

    const top = (scrollTop / scrollHeight);

    bar.style.top = `${top * 100}%`;

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
    this.off = this.bar.offsetTop - this.scroller.offsetTop;
    this.max = this.scroller.clientHeight - this.bar.clientHeight;
    addEventListener("mouseup", this.onmouseup);
    addEventListener("mousemove", this.onmousemove);
    nukeEvent(e);
  }

  onmouseup() {
    removeEventListener("mouseup", this.onmouseup);
    removeEventListener("mousemove", this.onmousemove);
  }

  onmousemove(e) {
    const off = this.start - e.pageY;
    const newPos = Math.max(
      0, Math.min(this.max, this.off - off)
    ) / this.scroller.clientHeight;
    this.el.scrollTop = this.el.scrollHeight * newPos;
    nukeEvent(e);
  }
}
