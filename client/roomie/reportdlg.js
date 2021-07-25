"use strict";

import registry from "../registry";
import Modal from "../modal";

export class ReportModal extends Modal {
  constructor(owner) {
    super("report", "Report", {
      text: "Send Report",
      default: true
    }, {
      text: "Cancel",
      cancel: true
    });
    this.owner = owner;
    this.body.innerHTML = document.querySelector("#report-tmpl").innerHTML;
    this.el.elements.room.value = `#${registry.roomid}`;
  }

  onshown() {
    this.el.elements.msg.focus();
  }

  async validate() {
    this.disable();
    try {
      if (!this.el.elements.agreement.checked) {
        throw new Error("You did not agree to the report rules!");
      }
      const msg = this.el.elements.msg.value.trim();
      if (!msg) {
        throw new Error("You cannot submit empty reports!");
      }
      await registry.socket.emit("report", msg);
      return true;
    }
    catch (ex) {
      await this.owner.showMessage(
        ex.message || ex,
        "Error",
        "i-error");
      return false;
    }
    finally {
      this.enable();
    }
  }
}
