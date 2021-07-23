"use strict";

import Modal from "../modal";

export class HelpModal extends Modal {
  constructor(owner) {
    super("helpdlg", "Commands Help!", {
      text: "Alright!",
      default: true,
    });
    this.owner = owner;
    this.body.appendChild(
      document.querySelector("#help-tmpl").content.cloneNode(true));
  }

  validate() {
    return true;
  }
}
