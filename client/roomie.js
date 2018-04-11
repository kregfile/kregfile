"use strict";

const registry = require("./registry");

class Roomie {
  constructor() {
    this._name = "New Room";
    this.unread = 0;
    this.hidden = document.hidden;

    registry.config.on("set-roomname", v => this.name = v);

    registry.messages.on("message", () => {
      if (!this.hidden) {
        return;
      }
      this.unread++;
      this._updateTitle();
    });

    document.addEventListener("visibilitychange", () => {
      this.hidden = document.hidden;
      if (!this.hidden) {
        this.unread = 0;
      }
      this._updateTitle();
    });
  }

  get name() {
    return this._name;
  }

  set name(nv) {
    this._name = nv || "";
    this._updateTitleAndName();
  }

  _updateTitle() {
    const unread = this.unread ? `(${this.unread}) ` : "";
    document.title = `${unread}${this.name} - kregfile`;
  }

  _updateTitleAndName() {
    this._updateTitle();
    document.querySelector("#name").textContent = this.name;
  }
}

module.exports = { Roomie };
