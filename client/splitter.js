"use strict";

import EventEmitter from "events";
import {nukeEvent} from "./util";
import registry from "./registry";

export default new class Splitter extends EventEmitter {
  constructor() {
    super();
    this.el = document.querySelector("#splitter");
    this.chat = document.querySelector("#chat");
    this.onmouseup = this.onmouseup.bind(this);
    this.onmousemove = this.onmousemove.bind(this);
    this.abort = this.abort.bind(this);
  }

  init() {
    this.el.addEventListener("mousedown", this.onmousedown.bind(this));
    this.restore();
  }

  onmousedown(e) {
    this.el.style.left = `${e.pageX}px`;
    this.el.classList.toggle("dragging");
    addEventListener("mouseup", this.onmouseup);
    addEventListener("mousemove", this.onmousemove);
    registry.roomie.on("hidden", this.abort);
    nukeEvent(e);
  }

  restore() {
    let item = localStorage.getItem("clientWidth");
    if (!item) {
      return;
    }
    item = JSON.parse(item);
    if (!item.width || !item.page) {
      localStorage.removeItem("clientWidth");
      return;
    }
    if (Math.abs(document.body.clientWidth - item.page) > 32) {
      localStorage.removeItem("clientWidth");
      return;
    }
    this.adjust(item.width);
  }

  clamp(w) {
    return Math.min(750, Math.max(250, w));
  }

  adjust(width) {
    width = this.clamp(width);
    this.chat.style.width = `${width}px`;
    this.chat.style.minWidth = `${width}px`;
    document.body.style.gridTemplateColumns = "auto 1ex 2fr";
    localStorage.setItem("clientWidth", JSON.stringify({
      width,
      page: document.body.clientWidth,
    }));
    this.emit("adjusted");
  }

  abort() {
    this.el.style.left = "auto";
    this.el.classList.toggle("dragging");
    removeEventListener("mouseup", this.onmouseup);
    removeEventListener("mousemove", this.onmousemove);
    registry.roomie.removeListener("hidden", this.abort);
  }


  onmouseup(e) {
    const x = this.clamp(e.pageX);
    this.adjust(x);
    this.abort();
  }

  onmousemove(e) {
    const x = this.clamp(e.pageX);
    this.el.style.left = `${x}px`;
  }
}();
