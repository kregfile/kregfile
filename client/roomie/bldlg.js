"use strict";

import registry from "../registry";
import Modal from "../modal";
import {dom} from "../util";

export class BlacklistModal extends Modal {
  constructor(owner, files) {
    super("bldlg", "Never again!", {
      text: "Blacklist",
      default: true,
    }, {
      text: "Cancel",
      cancel: true,
    });
    this.owner = owner;
    this.files = files;
    this.body.innerHTML = document.querySelector("#bl-tmpl").innerHTML;
    const fields = [
      "mute", "upload", "hellban",
      "hours", "reason", "templates"
    ];
    for (const f of fields) {
      this[f] = this.el.elements[f];
    }
    const {templates} = this;
    templates.appendChild(dom("option"));
    for (const k of Object.keys(window.templates)) {
      templates.appendChild(dom("option", {
        attrs: {value: k},
        text: k
      }));
    }
    templates.addEventListener("change", this.ontemplate.bind(this));
  }

  ontemplate(e) {
    this.setTemplate(e.target.value);
  }

  setTemplate(tmpl) {
    let t = window.templates[tmpl];
    if (!t) {
      t = { text: "", hours: 0 };
    }
    else {
      this.templates.value = tmpl;
    }
    this.mute.checked = !!t.mute;
    this.upload.checked = !!t.upload;
    this.hellban.checked = !!t.hellban;
    this.reason.value = t.text;
    this.hours.value = t.hours;
  }

  async validate() {
    try {
      const options = {
        mute: this.mute.checked,
        upload: this.upload.checked,
        hellban: this.hellban.checked,
        reason: this.reason.value,
        hours: parseInt(this.hours.value, 10),
      };
      if (!isFinite(options.hours) || options.hours < 0) {
        throw new Error("Pls, invalid duration!");
      }
      registry.socket.emit("blacklist", options, this.files);
      return true;
    }
    catch (ex) {
      await this.owner.showMessage(
        ex.message || ex,
        "Error",
        "i-error");
    }
    return false;
  }
}
