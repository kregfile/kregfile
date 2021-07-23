"use strict";

import registry from "../registry";
import Modal from "../modal";

export class LoginModal extends Modal {
  constructor(owner) {
    super("login", "Login", {
      text: "Login",
      default: true
    }, {
      text: "Cancel",
      cancel: true
    });
    this.owner = owner;
    this.body.innerHTML = document.querySelector("#login-tmpl").innerHTML;
  }

  get user() {
    return this.el.elements.u.value;
  }

  get password() {
    return this.el.elements.p.value;
  }

  get tfa() {
    return this.el.elements.t.value;
  }

  onshown() {
    this.el.elements.u.focus();
  }

  async validate() {
    const {user, password, tfa} = this;
    if (!user || !password) {
      await this.owner.showMessage(
        "Provide a user name and password",
        "Error",
        "i-error");
      return false;
    }
    this.disable();
    try {
      const res = await registry.socket.rest("login", {
        u: user,
        p: password,
        t: tfa
      });
      if (!res) {
        throw new Error("Could not log in!");
      }
      if (res.twofactor) {
        this.el.querySelector(".tfa-label").classList.remove("hidden");
        const tfa = this.el.querySelector(".tfa");
        tfa.classList.remove("hidden");
        tfa.focus();
        return false;
      }
      if (!res.session) {
        throw new Error("Could not log in!");
      }
      registry.socket.emit("session", res.session);
      registry.chatbox.setNick(user);
      registry.messages.add({
        user: "System",
        role: "system",
        volatile: true,
        msg: "Successfully logged in!"
      });
      if (window.PasswordCredential) {
        const cred = new window.PasswordCredential({
          id: user.toLowerCase(),
          password
        });
        try {
          await navigator.credentials.store(cred);
        }
        catch (ex) {
          console.error("Failed to save cred", ex);
        }
      }
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
