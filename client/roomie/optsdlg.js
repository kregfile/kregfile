"use strict";

import registry from "../registry";
import Modal from "../modal";
import {UsersModal} from "./usersdlg";

export class OptionsModal extends Modal {
  constructor(owner) {
    super("optsdlg", "Room Options", {
      text: "Change",
      default: true,
    }, {
      text: "Cancel",
      cancel: true,
    });
    this.owner = owner;
    this.body.innerHTML = document.querySelector("#roomopts-tmpl").innerHTML;
    const fields = [
      "owners", "invitees",
      "name", "motd",
      "inviteonly", "adult", "disabled",
      "disablereports", "ttl",
    ];
    for (const f of fields) {
      this[f] = this.el.elements[f];
    }

    this.owners.addEventListener("click", this.onowners.bind(this));
    this.invitees.addEventListener("click", this.oninvitees.bind(this));
    this.inviteonly.addEventListener("change", this.oninviteonly.bind(this));

    const {config: c} = registry;
    this.name.value = c.get("roomname");
    this.motd.value = c.get("rawmotd") || "";
    this.inviteonly.checked = !!c.get("inviteonly");
    this.adult.checked = !!c.get("adult");
    this.disabled.checked = !!c.get("disabled");
    this.disablereports.checked = !!c.get("disableReports");
    this.ttl.value = c.get("fileTTL") || 0;
    this.owners = null;
    this.invitees = null;

    this.oninviteonly();
  }

  async showUsersDlg(title, description, users, warnSelf) {
    try {
      const list = this[users] || registry.config.get(users) || [];
      const usersDlg = new UsersModal(
        this.owner, title, description, list, warnSelf);
      await this.owner.showModal(usersDlg);
      this[users] = usersDlg.users;
    }
    catch (ex) {
      if (ex) {
        console.error(ex);
      }
    }
  }

  oninviteonly() {
    if (this.inviteonly.checked) {
      this.el.elements.invitees.classList.remove("hidden");
    }
    else {
      this.el.elements.invitees.classList.add("hidden");
    }
  }

  async onowners() {
    await this.showUsersDlg(
      "Room Owners",
      `
Room owners can manage room options, just like yourself.
They can also add and remove room owners (including you), so be
very careful who you add.`,
      "owners",
      true);
  }

  async oninvitees() {
    await this.showUsersDlg(
      "Room Invitees",
      `
Only invited users and room owners can join this room.
Once you remove a user, they will be kicked!
However, if they started any downloads before being kicked, those downloads
will NOT be aborted, and they also retain their chat histories.`,
      "invitees");
  }

  async validate() {
    try {
      const {socket, config: c} = registry;
      const {value: name} = this.name;
      const {value: motd} = this.motd;
      let {value: ttl} = this.ttl;
      const {checked: inviteonly} = this.inviteonly;
      const {checked: adult} = this.adult;
      const {checked: disabled} = this.disabled;
      const {checked: disableReports} = this.disablereports;

      ttl = parseInt(ttl, 10);
      if (ttl.toString() !== this.ttl.value) {
        throw new Error("Invalid ttl (1)");
      }
      if (ttl < 0 || !isFinite(ttl)) {
        throw new Error("Invalid ttl");
      }

      if (name !== c.get("roomname")) {
        await socket.makeCall("setconfig", "name", name);
      }
      if (motd !== c.get("rawmotd")) {
        await socket.makeCall("setconfig", "motd", motd);
      }
      if (adult !== !!c.get("adult")) {
        await socket.makeCall("setconfig", "adult", adult);
      }
      if (registry.chatbox.role === "mod") {
        if (disabled !== !!c.get("disabled")) {
          await socket.makeCall("setconfig", "disabled", disabled);
        }
        if (ttl !== !!c.get("fileTTL")) {
          await socket.makeCall("setconfig", "fileTTL", ttl);
        }
        if (disableReports !== !!c.get("disableReports")) {
          await socket.makeCall("setconfig", "disableReports", disableReports);
        }
      }

      if (this.invitees) {
        await socket.makeCall("setconfig", "invitees", this.invitees);
      }
      // Make sure we set this after invitees to avoid kicking the wrong people
      if (inviteonly !== !!c.get("inviteonly")) {
        await socket.makeCall("setconfig", "inviteonly", inviteonly);
      }

      // Set owners last in case we remove ourselves
      if (this.owners) {
        await socket.makeCall("setconfig", "owners", this.owners);
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
