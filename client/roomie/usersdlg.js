"use strict";

import registry from "../registry";
import Modal from "../modal";
import {dom, nukeEvent, sort, naturalSort} from "../util";

export class UsersModal extends Modal {
  constructor(owner, title, description, users, warnSelf) {
    super("optsdlg", title, {
      text: "Done",
      default: true,
    }, {
      text: "Cancel",
      cancel: true,
    });
    this.body.innerHTML = document.querySelector("#users-tmpl").innerHTML;

    this.owner = owner;
    this.warnSelf = !!warnSelf;
    this.userMap = new Map();
    this.userList = this.el.querySelector(".userlist");
    this.el.querySelector(".usersdesc").textContent = description;
    this.name = this.el.elements.name;
    this.name.addEventListener("keydown", this.onname.bind(this));

    sort(Array.from(users), naturalSort).forEach(u => this.addUser(u));
    this.name.focus();
  }

  addUser(u, front) {
    const el = dom("div", {
      classes: ["userlistitem"],
    });
    el.appendChild(dom("div", {
      text: u
    }));
    this.userMap.set(u, el);
    const btn = dom("button", {
      classes: ["i-clear"]
    });
    btn.addEventListener("click", () => {
      this.userMap.delete(u);
      el.parentElement.removeChild(el);
    });
    el.appendChild(btn);
    if (front) {
      this.userList.insertBefore(el, this.userList.firstChild);
    }
    else {
      this.userList.appendChild(el);
    }
  }

  async onname(e) {
    if (e.key !== "Enter") {
      return;
    }
    nukeEvent(e);
    try {
      const account = this.name.value.toLowerCase().trim();
      const existing = this.userMap.get(account);
      if (existing) {
        this.name.value = "";
        existing.scrollIntoView();
        return;
      }
      await registry.socket.makeCall("profileinfo", account);
      this.addUser(account, true);
      this.name.value = "";
    }
    catch (ex) {
      await this.owner.showMessage(ex.message, "Invalid User", "i-error");
    }
    finally {
      this.name.focus();
    }
  }

  get users() {
    return Array.from(this.userMap.keys());
  }

  async validate() {
    if (!this.warnSelf ||
      registry.chatbox.role === "mod" ||
      this.userMap.has(registry.chatbox.currentNick.toLowerCase())) {
      return true;
    }
    try {
      await this.owner.question(
        `
You aren't in the list anymore.
Sure you want to remove yourself?`,
        "Warning",
        "i-warning");
      return true;
    }
    catch (ex) {
      return false;
    }
  }
}
