"use strict";

import Removable from "./removable";
import { dom, Rect } from "./util";

const OFFSET = 16;
const SOFFSET = 2;

export default class Tooltip extends Removable {
  constructor(name) {
    super();
    this.el = dom("div", {classes: ["tooltip"]});
    this.el.appendChild(dom("span", {
      classes: ["tooltip-name"],
      text: name
    }));
  }

  position(x, y) {
    const {width, height} = this.el.getBoundingClientRect();
    const {innerWidth, innerHeight} = window;
    // top-right by default
    let client = new Rect(
      x + OFFSET, y - height + SOFFSET, 0, 0, width, height);
    const available = new Rect(0, 0, innerWidth, innerHeight);

    // Does not fit, move center
    if (client.top < available.top) {
      client.offset(0, client.height / 2);
    }
    // Still does not fit, just move bottom
    if (client.top < available.top) {
      client = new Rect(x + OFFSET, y + OFFSET, 0, 0, width, height);
    }

    // Does not fit right, move left
    if (client.right > available.right) {
      client.offset(-client.width - OFFSET * 2, 0);
    }

    this.el.style.left = `${client.left}px`;
    this.el.style.top = `${client.top}px`;
  }

  show() {
    this.el.classList.add("visible");
  }
}
