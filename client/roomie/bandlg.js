"use strict";

import registry from "../registry";
import Modal from "../modal";
import {dom} from "../util";

function parseSubjects(text) {
  const subjects = {
    accounts: new Set(),
    ips: new Set(),
  };
  for (const p of text.split(/\s+/)) {
    if (p.startsWith("acct:")) {
      subjects.accounts.add(p.slice(5));
      continue;
    }
    if (p.startsWith("ip:")) {
      subjects.ips.add(p.slice(3));
      continue;
    }
    if (p.includes(".") || p.includes(":")) {
      subjects.ips.add(p);
    }
    throw new Error(`Invalid value: ${p}`);
  }
  subjects.accounts = Array.from(subjects.accounts);
  subjects.ips = Array.from(subjects.ips);
  if (!subjects.accounts.length && !subjects.ips.length) {
    throw new Error("No subjects specified");
  }
  return subjects;
}

export class BanModal extends Modal {
  constructor(owner, subjects, template) {
    super("bandlg", "Ban, ban, BAN!", {
      text: "BAN",
      default: true,
    }, {
      text: "Cancel",
      cancel: true,
    });
    this.owner = owner;
    this.body.innerHTML = document.querySelector("#ban-tmpl").innerHTML;
    const fields = [
      "s",
      "mute", "upload", "hellban", "purge",
      "hours", "reason", "templates"
    ];
    for (const f of fields) {
      this[f] = this.el.elements[f];
    }
    if (subjects) {
      subjects = subjects.accounts.map(a => `acct:${a}`).concat(
        subjects.ips.map(i => `ip:${i}`)).join(" ");
      this.s.value = subjects;
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
    this.setTemplate(template);
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
    this.purge.checked = !!t.purge;
    this.reason.value = t.text;
    this.hours.value = t.hours;
  }

  async validate() {
    try {
      const subjects = parseSubjects(this.s.value);
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
      registry.socket.emit("ban", subjects, options);
      if (this.purge.checked) {
        await registry.files.purgeFrom(subjects);
      }
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

export class UnbanModal extends Modal {
  constructor(owner, subjects) {
    super("unbandlg", "They been gud!", {
      text: "Unban",
      default: true,
    }, {
      text: "Cancel",
      cancel: true,
    });
    this.owner = owner;
    this.body.innerHTML = document.querySelector("#unban-tmpl").innerHTML;
    const fields = [
      "s",
      "mute", "upload", "hellban", "reason",
    ];
    for (const f of fields) {
      this[f] = this.el.elements[f];
    }
    if (subjects) {
      subjects = subjects.accounts.map(a => `acct:${a}`).concat(
        subjects.ips.map(i => `ip:${i}`)).join(" ");
      this.s.value = subjects;
    }
  }

  async validate() {
    try {
      const subjects = parseSubjects(this.s.value);
      const options = {
        mute: this.mute.checked,
        upload: this.upload.checked,
        hellban: this.hellban.checked,
        reason: this.reason.value,
      };
      registry.socket.emit("unban", subjects, options);
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
