"use strict";

const EventEmitter = require("events");
const {debounce, Rect} = require("./util");

const CLICK_DIFF = 16;
const MENU_OPEN_BOUNCE = 500;

let ids = 0;

class MenuItemBase {
  constructor(owner, id, text, {
    class: className = "",
    icon = "",
    autohide = ""
  }) {
    this.owner = owner;
    if (!id) {
      id = `contextmenu-${++ids}`;
    }
    this.id = id;
    this.text = text || "";
    this.icon = icon || "";
    this.autohide = autohide !== "false";

    this.elem = document.createElement("li");
    this.elem.id = this.id;
    this.elem.className = className;
    this.iconElem = document.createElement("span");
    this.textElem = document.createElement("span");
    this.elem.appendChild(this.iconElem);
    this.elem.appendChild(this.textElem);
  }

  materialize() {
    this.elem.classList.add("context-menu-item");
    this.iconElem.className = "context-menu-icon";
    if (this.icon) {
      this.iconElem.classList.add(...this.icon.split(" "));
    }
    this.textElem.textContent = this.text;
    this.textElem.className = "context-menu-text";
  }
}

class MenuItem extends MenuItemBase {
  constructor(owner, id, text, options = {}) {
    super(owner, id, text, options);
    this.disabled = !!options.disabled;
    this.elem.setAttribute("aria-role", "menuitem");
    this.elem.addEventListener(
      "click", () => this.owner.emit("clicked", this.id, this.autohide));
  }
  get disabled() {
    return this.elem.classList.contains("disabled");
  }
  set disabled(nv) {
    this.elem.classList[nv ? "add" : "remove"]("disabled");
  }
}

class MenuSeperatorItem extends MenuItemBase {
  constructor(owner, id) {
    super(owner, id, "", {});
    this.elem.setAttribute("aria-role", "menuitem");
    this.elem.setAttribute("aria-hidden", "true");
  }

  materialize() {
    super.materialize();
    this.elem.classList.add("context-menu-seperator");
  }
}

class SubMenuItem extends MenuItemBase {
  constructor(owner, id, text, options = {}) {
    super(owner, id, text, options);
    this.elem.setAttribute("aria-role", "menuitem");
    this.elem.setAttribute("aria-haspopup", "true");

    this.menu = new ContextMenu();

    this.expandElem = document.createElement("span");
    this.expandElem.className = "context-menu-expand";
    this.expandElem.textContent = "►";
    this.elem.appendChild(this.expandElem);
    this.elem.addEventListener("click", event => {
      if (options.allowClick) {
        this.owner.emit("clicked", this.id, this.autohide);
      }
      event.stopPropagation();
      event.preventDefault();
      return false;
    }, true);
    this.owner.elem.addEventListener(
      "mouseenter", debounce(this.entered.bind(this), MENU_OPEN_BOUNCE), {
        capture: true,
        passive: true
      });
    this.owner.on("dismissed", () => {
      this.menu.dismiss();
    });
    this.owner.on("showing", () => {
      this.menu.dismiss();
    });
    this.menu.on("clicked", (...args) => {
      this.owner.emit("clicked", ...args);
    });
  }

  get itemRect() {
    return new Rect(
      this.owner.elem.offsetLeft,
      this.owner.elem.offsetTop + this.elem.offsetTop,
      0,
      0,
      this.elem.clientWidth - 2,
      this.elem.clientHeight
    );
  }

  entered(event) {
    if (event.target.classList.contains("context-menu")) {
      return;
    }
    if (event.target !== this.elem &&
        event.target.parentElement !== this.elem) {
      this.menu.dismiss();
      return;
    }
    if (!this.owner.showing) {
      return;
    }
    const {itemRect} = this;
    const {availableRect} = this.owner;
    const {clientWidth, clientHeight} = this.menu.elem;
    if (itemRect.right + clientWidth > availableRect.right) {
      itemRect.offset(-(itemRect.width + clientWidth - 2), 0);
    }
    if (itemRect.bottom + clientHeight > availableRect.bottom) {
      itemRect.offset(0, -(itemRect.height));
    }
    this.menu.show({clientX: itemRect.right, clientY: itemRect.top});
  }

  constructFromTemplate(el) {
    this.menu.constructFromTemplate(el);
  }

  materialize() {
    super.materialize();
    this.menu.materialize();
    this.elem.classList.add("context-menu-submenuitem");
  }
}

class ContextMenu extends EventEmitter {
  constructor(el) {
    super();
    this.id = `contextmenu-${++ids}`;
    this.items = [];
    this.itemMap = new Map();
    this.elem = document.createElement("ul");
    this.elem.className = "context-menu layer";
    if (el) {
      this.constructFromTemplate(el);
    }
    this.dismiss = this.dismiss.bind(this);
    this.hide();
    this.materialize();
  }

  get availableRect() {
    const {clientWidth: bodyWidth, clientHeight: bodyHeight} = document.body;
    const availableRect = new Rect(0, 0, 0, 0, bodyWidth, bodyHeight);
    return availableRect;
  }

  show(el, event) {
    this.dismiss();
    this.emit("showing");
    this.materialize();
    const {bottom: clientY, left: clientX} = el.getBoundingClientRect();
    const {clientWidth, clientHeight} = this.elem;
    const clientRect = new Rect(
      clientX, clientY, 0, 0, clientWidth, clientHeight);
    const {availableRect} = this;
    if (clientRect.left < 0) {
      clientRect.move(0, clientRect.top);
    }
    if (clientRect.left < 0) {
      clientRect.move(clientRect.left, 0);
    }
    if (clientRect.bottom > availableRect.bottom) {
      clientRect.offset(0, -(clientRect.height));
    }
    if (clientRect.right > availableRect.right) {
      clientRect.offset(-(clientRect.width), 0);
    }
    this.elem.style.left = `${clientRect.left}px`;
    this.elem.style.top = `${clientRect.top}px`;
    this.showing = true;
    this._maybeDismiss = this.maybeDismiss.bind(this, event);
    addEventListener("click", this._maybeDismiss, true);
    addEventListener("keydown", this.dismiss, true);
    return true;
  }

  dismiss() {
    if (!this.showing) {
      return;
    }
    removeEventListener("click", this._maybeDismiss, true);
    removeEventListener("keydown", this.dismiss, true);
    this.showing = false;
    this.hide();
    this.emit("dismissed");
  }

  destroy() {
    this.elem.parentElement.removeChild(this.elem);
    delete this.elem;
    this.items.length = 0;
  }

  maybeDismiss(origEvent, event) {
    if (!event) {
      return;
    }
    if (event.type === "click" && event.button === 2 &&
      origEvent.target === event.target &&
      Math.abs(event.clientX - origEvent.clientX) < CLICK_DIFF &&
      Math.abs(event.clientY - origEvent.clientY) < CLICK_DIFF) {
      return;
    }
    let el = event.target;
    while (el) {
      if (el.classList.contains("context-menu")) {
        return;
      }
      el = el.parentElement;
    }
    this.dismiss(event);
  }

  emit(event, ...args) {
    if (event !== "showing") {
      // non-autohide click?
      if (event !== "clicked" || args.length < 2 || args[1]) {
        this.dismiss();
      }
    }
    super.emit(event, ...args);
    if (event === "clicked") {
      const first = args.shift();
      super.emit(first, ...args);
    }
  }

  hide() {
    this.elem.style.top = "0px";
    this.elem.style.left = "-10000px";
  }

  get(id) {
    return this.itemMap.get(id);
  }

  add(item, before = "") {
    let idx = this.items.length;
    if (before) {
      before = before.id || before;
      const ni = this.items.findIndex(i => i.id === before);
      if (ni >= 0) {
        idx = ni;
      }
    }
    this.items.splice(idx, 0, item);
    this.itemMap.set(item.id, item);
  }

  remove(item) {
    const id = item.id || item;
    const idx = this.items.findIndex(i => i.id === id);
    if (idx >= 0) {
      this.items.splice(idx, 1);
      this.itemMap.delete(id);
    }
  }

  constructFromTemplate(el) {
    if (typeof el === "string") {
      el = document.querySelector(el);
    }
    el.parentElement.removeChild(el);
    this.id = el.id || this.id;
    for (const child of Array.from(el.children)) {
      let text = [];
      let sub = null;
      for (const sc of child.childNodes) {
        switch (sc.nodeType) {
        case Node.TEXT_NODE:
          text.push(sc.textContent.trim());
          break;

        case Node.ELEMENT_NODE:
          if (sub) {
            throw new Error("Already has a submenu");
          }
          if (sc.localName !== "ul") {
            throw new Error("Not a valid submenu");
          }
          sub = sc;
          break;
        default:
          throw new Error(`Invalid node: ${sc.localName}`);
        }
      }
      text = text.join(" ").trim();
      let item = null;
      if (text === "-") {
        item = new MenuSeperatorItem(this, child.id);
      }
      else if (sub) {
        item = new SubMenuItem(this, child.id, text, child.dataset);
        item.constructFromTemplate(sub);
      }
      else {
        item = new MenuItem(this, child.id, text, child.dataset);
      }
      this.items.push(item);
      this.itemMap.set(item.id, item);
    }
  }

  materialize() {
    this.elem.id = this.id;
    this.elem.textContent = "";
    for (const item of this.items) {
      item.materialize();
      this.elem.appendChild(item.elem);
    }
    document.body.appendChild(this.elem);
  }
}

module.exports = { ContextMenu, MenuItem, MenuSeperatorItem, SubMenuItem };
