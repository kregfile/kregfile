"use strict";

import EventEmitter from "events";
import registry from "./registry";
import toFilterFuncs from "./files-filter";
import {
  PromisePool,
  CoalescedUpdate,
  debounce,
  dom,
  naturalSort,
  sort,
  toPrettyDuration,
  toPrettySize,
} from "./util";
import {APOOL} from "./animationpool";

const NONE = Symbol();

const ROBOCOPFILES =
  /^(?:thumbs.*\.db|\.ds_store.*|.*\.ds_store|.\tthn|desktop.*.ini)$/i;

const BASE_FILE = {
  name: "",
  href: "#",
  tags: {},
  expires: 0,
};

const ICONS = Object.freeze(new Set([
  "video",
  "audio",
  "image",
  "document",
  "archive",
  "file",
]));

const REMOVALS = new CoalescedUpdate(0, a => {
  registry.files.removeFileElements(a);
});

const TTL = {
  PERSEC: new CoalescedUpdate(1000, a => a.forEach(e => {
    e.updateTTL();
    if (e.expired) {
      e.remove();
    }
    else {
      TTL.PERSEC.add(e);
    }
  })),
  PERMIN: new CoalescedUpdate(60000, a => a.forEach(e => {
    e.updateTTL();
    if (e.ttl < 60000) {
      TTL.PERSEC.add(e);
    }
    else {
      TTL.PERMIN.add(e);
    }
  })),
  PERHOUR: new CoalescedUpdate(3600000, a => a.forEach(e => {
    e.updateTTL();
    if (e.ttl < 3600000) {
      TTL.PERMIN.add(e);
    }
    else {
      TTL.PERHOUR.add(e);
    }
  })),

  add(e) {
    const {ttl} = e;
    if (ttl >= 3600000 * 2) {
      this.PERHOUR.add(e);
    }
    else if (ttl >= 60000 * 2) {
      this.PERMIN.add(e);
    }
    else {
      this.PERSEC.add(e);
    }
  },

  delete(e) {
    if (this.PERSEC.delete(e)) {
      return;
    }
    if (this.PERMIN.delete(e)) {
      return;
    }
    this.PERHOUR.delete(e);
  },

  clear() {
    this.PERSEC.clear();
    this.PERMIN.clear();
    this.PERHOUR.clear();
  }
};

class Removable {
  constructor() {
    this.remove = APOOL.wrap(this.remove);
  }

  remove() {
    try {
      if (this.el.parentElement) {
        this.el.parentElement.removeChild(this.el);
      }
    }
    catch (ex) {
      // ignored
    }
  }
}

class Upload extends Removable {
  constructor(file) {
    super();
    this.file = file;
    this.key = null;
    this.offset = null;

    this.el = dom("div", {classes: ["file", "upload"]});

    this.iconEl = dom("span", {
      classes: ["icon", "i-wait"],
    });
    this.el.appendChild(this.iconEl);

    this.nameEl = dom("span", {classes: ["name"], text: this.file.name});
    this.el.appendChild(this.nameEl);

    this.detailEl = dom("span", {classes: ["detail"]});
    this.el.appendChild(this.detailEl);

    this.sizeEl = dom("span", {
      classes: ["size"],
      text: toPrettySize(this.file.size)
    });
    this.detailEl.appendChild(this.sizeEl);

    this.setIcon = APOOL.wrap(this.setIcon);
  }

  getKey() {
    const {socket} = registry;
    const getter = (resolve, reject) => {
      socket.once("uploadkey", d => {
        if (d.err) {
          reject(new Error(d.err));
          return;
        }
        if (d.wait) {
          resolve(new Promise((iresolve, ireject) => {
            const dur = registry.roomie.diffTimes(d.wait);
            if (dur <= 0) {
              getter(iresolve, ireject);
              return;
            }
            this.sizeEl.textContent = `Waiting (${toPrettyDuration(dur)})`;
            setTimeout(() => getter(iresolve, ireject), Math.min(dur, 5000));
          }));
          return;
        }
        resolve(d);
      });
      setTimeout(() => reject("Timeout"), 30000);
      socket.emit("uploadkey");
    };
    return new Promise(getter);
  }

  queryOffset() {
    const {socket} = registry;
    return new Promise((resolve, reject) => {
      socket.once(`queryoffset-${this.key}`, d => {
        if (d.err) {
          reject(new Error(d.err));
          return;
        }
        resolve(d);
      });
      setTimeout(() => reject("Timeout"), 30000);
      socket.emit("queryoffset", this.key);
    });
  }

  async attemptUpload() {
    if (this.offset !== null) {
      this.offset = await this.queryOffset();
    }
    else {
      this.offset = 0;
    }
    const params = new URLSearchParams();
    params.set("name", this.file.name);
    params.set("key", this.key);
    params.set("offset", this.offset);
    return new Promise((resolve, reject) => {
      const req = new XMLHttpRequest();
      req.onerror = () => {
        console.error("onerror");
        reject(new Error("Connection lost"));
      };
      req.onabort = () => {
        console.error("onabort");
        const err = new Error("Aborted");
        err.retryable = true;
        reject(err);
      };
      req.onload = () => {
        resolve(req.response);
      };
      req.responseType = "json";
      req.upload.addEventListener("progress", e => {
        if (this.offset === 0 && e.loaded > (1 << 20)) {
          //req.abort();
        }
        this.setProgress(this.offset + e.loaded, this.offset + e.total);
      });
      req.open("PUT", `/api/upload?${params.toString()}`);
      let {file} = this;
      if (this.offset) {
        file = file.slice(this.offset);
      }
      req.send(file);
    });
  }

  setProgress(current, total) {
    const p = (current * 100 / total);
    if (p !== 100) {
      this.sizeEl.textContent = `${toPrettySize(current)}/${toPrettySize(total)} (${p.toFixed(1)}%)`;
    }
    else {
      this.sizeEl.textContent = `${toPrettySize(this.file.size)} - Finishing...`;
    }
    this.el.style.backgroundSize = `${p}% 100%`;
  }

  setIcon(cls) {
    this.iconEl.classList.remove(
      "i-wait", "i-upload", "i-upload-done", "i-error");
    this.iconEl.classList.add(cls);
  }

  async upload() {
    registry.chatbox.ensureNick();
    this.setIcon("i-upload");
    try {
      for (let i = 0; i <= 10; ++i) {
        if (!this.key) {
          const key = await this.getKey();
          this.key = key;
          this.offset = null;
        }
        try {
          const resp = await this.attemptUpload();
          if (resp.err) {
            const err = new Error(resp.err);
            Object.assign(err, resp);
            throw err;
          }
          registry.files.once(`file-added-${resp.key}`, () => this.remove());
          this.setProgress(1, 1);
          this.setIcon("i-upload-done");
        }
        catch (ex) {
          if (!ex.retryable || i === 10) {
            throw ex;
          }
          await new Promise(r => setTimeout(r, 10000));
          continue;
        }
        break;
      }
    }
    catch (ex) {
      this.el.classList.add("error");
      this.setIcon("i-error");
      this.sizeEl.textContent = "Upload failed";
      registry.messages.add({
        volatile: true,
        user: "Error",
        role: "system",
        msg: `Upload of "${this.file.name}" failed: ${ex.message || ex.toString()}`
      });
      setTimeout(() => this.remove(), 5000);
    }
  }
}

class File extends Removable {
  constructor(file) {
    super();
    Object.assign(this, BASE_FILE, file);

    this.el = dom("div", {classes: ["file"]});

    if (!ICONS.has(this.type)) {
      this.type = "file";
    }
    this.iconEl = dom("a", {
      attrs: {
        target: "_blank",
        rel: "nofollow,noindex",
        href: this.href
      },
      classes: ["icon", `i-${this.type}`],
    });
    this.el.appendChild(this.iconEl);

    this.nameEl = dom("a", {
      attrs: {
        target: "_blank",
        rel: "nofollow,noindex",
        href: this.href
      },
      classes: ["name"],
      text: this.name}
    );
    this.el.appendChild(this.nameEl);

    const tagEntries = Array.from(Object.entries(this.tags));
    tagEntries.forEach(e => e[1] = e[1].toString());
    this.tagsMap = new Map(tagEntries);
    tagEntries.forEach(e => e[1] = e[1].toUpperCase());
    this.tagsMapCase = new Map(tagEntries);
    this.tagValues = Array.from(this.tagsMap.values());
    this.tagValuesCase = Array.from(this.tagsMapCase.values());

    this.tagsEl = dom("span", {classes: ["tags"]});
    this.el.appendChild(this.tagsEl);
    const tags = sort(Array.from(this.tagsMap.entries()));
    for (const [tn, tv] of tags) {
      const tag = dom("span", {classes: ["tag", `tag-${tn}`], text: tv});
      tag.dataset.tag = tn;
      tag.dataset.tagValue = tv;
      this.tagsEl.appendChild(tag);
    }

    this.detailEl = dom("span", {classes: ["detail"]});
    this.el.appendChild(this.detailEl);

    this.sizeEl = dom("span", {
      classes: ["size"],
      text: toPrettySize(file.size)
    });
    this.detailEl.appendChild(this.sizeEl);

    this.ttlEl = dom("span", {
      classes: ["ttl"],
      text: "ttl",
    });
    this._updateTTL();
    TTL.add(this);

    this.ttlEl.insertBefore(
      dom("span", {classes: ["i-clock"]}), this.ttlEl.firstChild);
    this.detailEl.appendChild(this.ttlEl);
  }

  get ttl() {
    return registry.roomie.diffTimes(this.expires);
  }

  get expired() {
    return this.ttl <= 0;
  }

  _updateTTL() {
    const diff = Math.max(0, this.ttl);
    this.ttlEl.lastChild.textContent = toPrettyDuration(diff, true);
  }

  remove() {
    TTL.delete(this);
    REMOVALS.add(this);
    super.remove();
  }
}

File.prototype.updateTTL = APOOL.wrap(File.prototype._updateTTL);

export default new class Files extends EventEmitter {
  constructor() {
    super();
    this.el = document.querySelector("#files");
    this.filterButtons = Array.from(document.querySelectorAll(".filterbtn"));
    this.filterFunc = null;
    this.filter = document.querySelector("#filter");
    this.filterClear = document.querySelector("#filter-clear");
    this.filterStatus = document.querySelector("#filter-status");
    this.files = [];
    this.fileset = new Set();
    this.elmap = new WeakMap();
    this.onfiles = this.onfiles.bind(this);
    this.applying = null;
    this.applyFilter = APOOL.wrap(this.applyFilter);
    this.clear = APOOL.wrap(this.clear);
    this.addFileElements = APOOL.wrap(this.addFileElements);
    this.addUploadElements = APOOL.wrap(this.addUploadElements);
    this.uploadOne = PromisePool.wrapNew(1, this, this.uploadOne);
    this.onfilterbutton = this.onfilterbutton.bind(this);
    Object.seal(this);

    this.el.ondrop = this.ondrop.bind(this);
    this.el.ondragover = e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };

    this.filterButtons.forEach(e => {
      e.addEventListener("click", this.onfilterbutton, true);
      e.addEventListener("contextmenu", this.onfilterbutton, true);
    });
    this.filter.addEventListener(
      "input", debounce(this.onfilter.bind(this), 200));
    this.filterClear.addEventListener(
      "click", this.clearFilter.bind(this), true);

    this.el.addEventListener("click", this.onclick.bind(this));
    this.el.addEventListener("contextmenu", this.onclick.bind(this));
  }

  get visible() {
    return Array.from(document.querySelectorAll(".file:not(.upload)")).
      map(e => this.elmap.get(e)).
      filter(e => e);
  }

  init() {
    registry.socket.on("files", this.onfiles);
  }

  onclick(e) {
    const {target: el} = e;
    if (el.classList.contains("tag")) {
      e.preventDefault();
      e.stopPropagation();
      const {tag, tagValue} = el.dataset;
      if (e.button) {
        this.filter.value = `${this.filter.value} -${tag}:'${tagValue.replace(/'/g, "\\'")}'`.trim();
      }
      else {
        this.filter.value = `${tag}:'${tagValue.replace(/'/g, "\\'")}'`;
      }
      this.doFilter();
      return false;
    }
    return true;
  }

  onfilterbutton(e) {
    e.preventDefault();
    e.stopPropagation();

    try {
      const {target: btn} = e;
      const {filterButtons: btns} = this;
      if (e.button) {
        const anyEnabled = btns.some(
          e => e !== btn && !e.classList.contains("disabled"));
        btns.forEach(e => {
          e.classList[e === btn || !anyEnabled ? "remove" : "add"]("disabled");
        });
      }
      else {
        const act = btn.classList.contains("disabled") ? "remove" : "add";
        btn.classList[act]("disabled");
      }
    }
    catch (ex) {
      console.error(ex);
    }
    this.doFilter();
  }

  onfilter() {
    this.doFilter();
  }

  createFilterFunc() {
    const filters = new Set(this.filterButtons.
      map(e => e.classList.contains("disabled") ? null : e.id.slice(7)).
      filter(e => e));
    if (!filters.size) {
      return NONE;
    }
    const funcs = toFilterFuncs(this.filter.value);
    if (filters.size !== this.filterButtons.length) {
      funcs.push(function(e) {
        return filters.has(e.type);
      });
    }
    if (funcs.length === 1) {
      return funcs[0];
    }
    if (!funcs.length) {
      return null;
    }
    return function(e) {
      for (const func of funcs) {
        if (!func(e)) {
          return false;
        }
      }
      return true;
    };
  }

  clearFilter() {
    this.filterButtons.forEach(e => e.classList.remove("disabled"));
    this.filter.value = "";

    this.doFilter();
  }

  setFilter(value) {
    this.filter.value = value;
    this.doFilter();
  }

  doFilter() {
    this.filterFunc = this.createFilterFunc();
    this.filterClear.classList[this.filterFunc ? "remove" : "add"]("disabled");
    REMOVALS.trigger();
    if (!this.applying) {
      this.applying = this.applyFilter().then(() => this.applying = null);
    }
  }

  filtered(files) {
    const {filterFunc} = this;
    if (filterFunc === NONE) {
      files = [];
    }
    if (filterFunc) {
      return files.filter(filterFunc);
    }
    return files;
  }

  applyFilter() {
    try {
      const files = this.filtered(this.files);
      if (!files || !files.length) {
        this.visible.forEach(e => e.el.parentElement.removeChild(e.el));
        return;
      }

      // Remove now hidden
      const fileset = new Set(files);
      this.visible.forEach(e => {
        if (fileset.has(e)) {
          return;
        }
        e.el.parentElement.removeChild(e.el);
      });

      // Add all matching files
      this.insertFilesIntoDOM(files);
    }
    finally {
      this.adjustEmpty();
      this.updateFilterStatus();
    }
  }

  updateFilterStatus() {
    if (!this.files.length) {
      this.filterStatus.classList.add("disabled");
      return;
    }
    this.filterStatus.textContent = `${this.visible.length} of ${this.files.length} files`;
    this.filterStatus.classList.remove("disabled");
  }

  ondrop(e) {
    e.preventDefault();
    try {
      const files = [];
      const entries = [];
      const {dataTransfer: data} = e;
      if (data.items) {
        for (const file of Array.from(data.items)) {
          if (file.kind !== "file") {
            continue;
          }
          if (file.webkitGetAsEntry) {
            entries.push(file.webkitGetAsEntry());
            continue;
          }
          files.push(file.getAsFile());
        }
        data.items.clear();
      }
      else {
        for (const file of Array.from(data.files)) {
          files.push(file);
        }
        data.clearData();
      }
      this.queueUploads(entries, files);
    }
    catch (ex) {
      console.error("failed to handle drop", ex);
    }
    return false;
  }

  async processEntries(entries, files) {
    for (const entry of entries) {
      if (entry.isFile) {
        try {
          files.push(await this.toFile(entry));
        }
        catch (ex) {
          console.error("failed to get file for entry", entry);
        }
        continue;
      }
      if (entry.isDirectory) {
        try {
          await this.readDir(entry, files);
        }
        catch (ex) {
          console.error("failed to read directory", entry);
        }
        continue;
      }
      console.debug("unhandled entry", entry);
    }
  }

  async readDir(entry, files) {
    const reader = entry.createReader();
    await new Promise(resolve => {
      reader.readEntries(async entries => {
        await this.processEntries(entries, files);
        resolve();
      });
    });
  }

  toFile(entry) {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
  }

  async queueUploads(entries, files) {
    try {
      await this.processEntries(entries, files);
      sort(files, f => f.name, naturalSort).reverse();
      const uploads = files.
        filter(f => !ROBOCOPFILES.test(f.name)).
        map(f => new Upload(f));
      uploads.forEach(u => this.uploadOne(u));
      this.addUploadElements(uploads);
    }
    catch (ex) {
      console.error(ex);
    }
  }

  onfiles(data) {
    if (data.replace) {
      this.clear();
    }
    const files = data.files.map(f => {
      f = new File(f);
      this.elmap.set(f.el, f);
      this.emit("file-added", f);
      this.emit(`file-added-${f.key}`, f);
      return f;
    });
    this.addFileElements(files);
  }

  clear() {
    Array.from(document.querySelectorAll(".file:not(.upload)")).forEach(f => {
      try {
        this.el.removeChild(f);
      }
      catch (ex) {
        // ignored
      }
    });
    this.files.length = 0;
    this.fileset.clear();
    this.adjustEmpty();
    this.updateFilterStatus();
  }

  adjustEmpty() {
    if (this.el.childElementCount) {
      this.el.classList.remove("empty");
    }
    else {
      this.el.classList.add("empty");
    }
  }

  insertFilesIntoDOM(files) {
    let head = document.querySelector(".file:not(.upload)");
    for (const f of this.filtered(files)) {
      if (head) {
        this.el.insertBefore(f.el, head);
      }
      else {
        this.el.appendChild(f.el);
      }
      head = f.el;
    }
  }

  addFileElements(files) {
    try {
      REMOVALS.trigger();
      // XXX not restore save
      if (!this.files.length) {
        this.files = files;
        this.fileset = new Set(this.files);
      }
      else {
        this.files.push(...files);
        if (files.length > 5) {
          this.fileset = new Set(this.files);
        }
        else {
          files.forEach(e => this.fileset.add(e));
        }
      }
      this.insertFilesIntoDOM(files);
      this.adjustEmpty();
      this.updateFilterStatus();
    }
    catch (ex) {
      console.error(ex);
    }
  }

  removeFileElements(files) {
    if (files.length > 3) {
      for (const f of files) {
        this.fileset.delete(f);
      }
      this.files = Array.from(this.fileset);
      return;
    }
    for (const f of files) {
      if (this.fileset.delete(f)) {
        this.files.splice(this.files.indexOf(f), 1);
      }
    }
    this.adjustEmpty();
  }

  addUploadElements(uploads) {
    try {
      for (const u of uploads) {
        this.el.insertBefore(u.el, this.el.firstChild);
      }
      this.adjustEmpty();
    }
    catch (ex) {
      console.error(ex);
    }
  }

  async uploadOne(u) {
    await u.upload();
  }
}();
