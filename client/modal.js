"use strict";

import {dom, nukeEvent} from "./util";

export default class Modal {
  constructor(id, name, ...buttons) {
    this.el = dom("form", {
      classes: ["modal", `modal-${id}`],
    });
    this.el.addEventListener("submit", this.onsubmit.bind(this));

    this.head = dom("div", {
      classes: ["modal-head"],
      text: name,
    });
    this.el.appendChild(this.head);

    this.body = dom("div", {
      classes: ["modal-body"],
    });
    this.el.appendChild(this.body);

    this.buttons = [];
    this.buttonsEl = dom("div", {
      classes: ["modal-buttons"],
    });
    this.cancel = null;
    this.def = null;
    for (const button of buttons) {
      const cls = ["modal-button"];
      if (button.cls) {
        cls.push(button.cls);
      }
      if (button.cancel) {
        if (this.cancel) {
          throw new Error("Two cancel buttons!");
        }
        this.cancel = button;
        cls.push("modal-button-cancel");
      }
      if (button.default) {
        if (this.default) {
          throw new Error("Two default buttons!");
        }
        this.default = button;
        cls.push("modal-button-default");
      }
      const btn = dom("button", {
        classes: cls,
        attrs: {
          type: button.default ? "submit" : "button",
        },
        text: button.text,
      });
      btn.onclick = e => this.onclick(button, e);
      this.buttons.push(btn);
      button.btn = btn;
      this.buttonsEl.appendChild(btn);
    }
    this.el.appendChild(this.buttonsEl);
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  enable() {
    this.buttons.forEach(e => {
      e.removeAttribute("disabled");
    });
  }

  disable() {
    this.buttons.forEach(e => {
      e.setAttribute("disabled", "disabled");
    });
  }

  onshown() {
    if (this.default) {
      this.default.btn.focus();
      return;
    }
    if (this.cancel) {
      this.cancel.btn.focus();
      return;
    }
  }

  validate() {
    return true;
  }

  async onclick(button, e) {
    nukeEvent(e);
    if (button.cancel) {
      this.reject();
      return;
    }
    if (!await this.validate()) {
      return;
    }
    this.resolve(button.id || "accept");
  }

  onsubmit(e) {
    nukeEvent(e);
    return false;
  }

  dismiss() {
    this.reject();
  }

  accept() {
    if (this.default) {
      this.default.btn.click();
    }
    else {
      console.log("no default");
    }
  }
}

export class MessageBox extends Modal {
  constructor(caption, text, icon, ...buttons) {
    if (!buttons.length) {
      buttons.push({
        default: true,
        text: "OK",
      });
    }
    icon = icon || "i-warning";
    super("messagebox", caption, ...buttons);
    this.el.classList.add("modal-messagebox");
    const {body} = this;
    body.appendChild(dom("span", {
      classes: ["modal-messagebox-icon", icon]
    }));
    body.appendChild(dom("span", {
      classes: ["modal-messagebox-text"],
      text
    }));
  }
}
