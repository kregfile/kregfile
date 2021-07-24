"use strict";

import registry from "../registry";
import Modal from "../modal";

export class ChangePWModal extends Modal {
  constructor(owner) {
    super("changepw", "Change password", {
      text: "Set New Password",
      default: true
    }, {
      text: "Cancel",
      cancel: true
    });
    this.owner = owner;
    this.body.innerHTML = document.querySelector("#changepw-tmpl").innerHTML;
    this.el.elements.u.value = registry.chatbox.authed;
  }

  get current() {
    return this.el.elements.c.value;
  }

  get password() {
    return this.el.elements.p.value;
  }

  get confirmation() {
    return this.el.elements.confirmation.value;
  }

  get tfa() {
    return this.el.elements.t.value;
  }

  onshown() {
    this.el.elements.c.focus();
  }

  async validate() {
    const {current, password, tfa} = this;
    if (!current || !password) {
      await this.owner.showMessage(
        "Enter your old and new passwords",
        "Error",
        "i-error");
      return false;
    }
    if (password !== this.confirmation) {
      await this.owner.showMessage(
        "The new password does not match the confirmation",
        "Error",
        "i-error");
      return false;
    }
    this.disable();
    try {
      const res = await registry.socket.rest("changepw", {
        c: current,
        p: password,
        t: tfa
      });
      if (!res) {
        throw new Error("Could not change your password!");
      }
      if (res.twofactor) {
        this.el.querySelector(".tfa-label").classList.remove("hidden");
        const tfa = this.el.querySelector(".tfa");
        tfa.classList.remove("hidden");
        tfa.focus();
        return false;
      }
      if (!res.success || typeof res.authed !== "string") {
        throw new Error("Something went horribly wrong");
      }
      if (window.PasswordCredential) {
        const cred = new window.PasswordCredential({
          id: res.authed.toLowerCase(),
          password
        });
        try {
          await navigator.credentials.store(cred);
        }
        catch (ex) {
          console.error("Failed to save cred", ex);
        }
      }

      registry.messages.add({
        user: "System",
        role: "system",
        volatile: true,
        msg: "Successfully changed password!"
      });

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
