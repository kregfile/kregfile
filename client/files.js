"use strict";

import EventEmitter from "events";
import registry from "./registry";
import * as filesfilter from "./files/filter";
import {
  PromisePool,
  debounce,
  naturalCaseSort,
  sort,
} from "./util";
import {APOOL} from "./animationpool";
import {REMOVALS} from "./files/tracker";
import Upload from "./files/upload";
import File from "./files/file";

const ROBOCOPFILES =
  /^(?:thumbs.*\.db|\.ds_store.*|.*\.ds_store|.\tthn|desktop.*.ini)$/i;

export default new class Files extends EventEmitter {
  constructor() {
    super();
    this.el = document.querySelector("#files");
    this.ubutton = document.querySelector("#upload-button");
    this.filterButtons = Array.from(document.querySelectorAll(".filterbtn"));
    this.filterFunc = null;
    this.filter = document.querySelector("#filter");
    this.filterClear = document.querySelector("#filter-clear");
    this.filterStatus = document.querySelector("#filter-status");
    this.files = [];
    this.filemap = new Map();
    this.elmap = new WeakMap();

    this.tooltipFile = null;
    this.tooltip = null;
    this.mousepos = Object.seal({x: 0, y: 0});

    this.onmousemove = this.onmousemove.bind(this);
    this.showTooltip = debounce(this.showTooltip.bind(this), 250);
    this.onfiles = this.onfiles.bind(this);
    this.onfilesdeleted = this.onfilesdeleted.bind(this);
    this.onfilesupdated = this.onfilesupdated.bind(this);
    this.applying = null;
    this.applyFilter = APOOL.wrap(this.applyFilter);
    this.clear = APOOL.wrap(this.clear);
    this.addFileElements = APOOL.wrap(this.addFileElements);
    this.addUploadElements = APOOL.wrap(this.addUploadElements);
    this.uploadOne = PromisePool.wrapNew(1, this, this.uploadOne);
    this.onfilterbutton = this.onfilterbutton.bind(this);
    this.onuploadbutton = this.onuploadbutton.bind(this);
    Object.seal(this);

    const dragBody = e => {
      if (!e.dataTransfer.types.includes("Files")) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "none";
    };
    addEventListener("dragenter", dragBody);
    addEventListener("dragover", dragBody);
    const dragEnter = e => {
      this.hideTooltip();
      if (!e.dataTransfer.types.includes("Files")) {
        return;
      }
      this.adjustEmpty(true);
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    };
    const dragExit = e => {
      if (e.target !== this.el) {
        return;
      }
      this.adjustEmpty();
    };
    this.el.addEventListener("drop", this.ondrop.bind(this), true);
    this.el.addEventListener("dragenter", dragEnter, true);
    this.el.addEventListener("dragover", dragEnter, true);
    this.el.addEventListener("dragexit", dragExit, true);
    this.el.addEventListener("dragleave", dragExit, true);
    this.el.addEventListener("mouseout", dragExit, true);

    this.filterButtons.forEach(e => {
      e.addEventListener("click", this.onfilterbutton, true);
      e.addEventListener("contextmenu", this.onfilterbutton, true);
    });
    this.filter.addEventListener(
      "input", debounce(this.onfilter.bind(this), 200));
    this.filterClear.addEventListener(
      "click", this.clearFilter.bind(this), true);

    this.ubutton.addEventListener("change", this.onuploadbutton.bind(this));

    this.el.addEventListener("click", this.onclick.bind(this));
    this.el.addEventListener("mouseout", this.onout.bind(this));
  }

  get visible() {
    return Array.from(document.querySelectorAll(".file:not(.upload)")).
      map(e => this.elmap.get(e)).
      filter(e => e);
  }

  init() {
    registry.socket.on("files", this.onfiles);
    registry.socket.on("files-deleted", this.onfilesdeleted);
    registry.socket.on("files-updated", this.onfilesupdated);
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

  onenter(file) {
    if (!this.tooltipFile) {
      this.el.addEventListener("mousemove", this.onmousemove);
    }
    this.tooltipFile = file;
    this.showTooltip();
  }

  onmousemove(e) {
    const x = this.mousepos.x = e.pageX;
    const y = this.mousepos.y = e.pageY;
    if (this.tooltip) {
      this.tooltip.position(x, y);
    }
  }

  onout(e) {
    if (this.el === e.target) {
      this.adjustEmpty();
    }

    if (!this.tooltipFile) {
      return;
    }
    this.tooltipFile = null;
    this.el.removeEventListener("mousemove", this.onmousemove);
    this.hideTooltip();
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
    this.filterFunc = filesfilter.toFilterFuncs(
      this.filterButtons, this.filter.value);
    this.filterClear.classList[this.filterFunc ? "remove" : "add"]("disabled");
    REMOVALS.trigger();
    if (!this.applying) {
      this.applying = this.applyFilter().then(() => this.applying = null);
    }
  }

  filtered(files) {
    const {filterFunc} = this;
    if (filterFunc === filesfilter.NONE) {
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

  hideTooltip() {
    if (!this.tooltip) {
      return;
    }
    this.tooltip.remove();
    this.tooltip = null;
  }

  showTooltip() {
    if (!this.tooltipFile) {
      return;
    }
    const tt = this.tooltipFile.generateTooltip();
    if (!tt) {
      return;
    }
    this.tooltip = tt;
    document.body.appendChild(tt.el);
    APOOL.schedule(null, () => {
      if (!this.tooltip) {
        return;
      }
      const {x, y} = this.mousepos;
      this.tooltip.position(x, y);
      this.tooltip.show();
    });
  }

  updateFilterStatus() {
    if (!this.files.length) {
      this.filterStatus.classList.add("disabled");
      return;
    }
    this.filterStatus.textContent = `${this.visible.length} of ${this.files.length} files`;
    this.filterStatus.classList.remove("disabled");
  }

  onuploadbutton() {
    try {
      let files = [];
      let entries = [];
      if (this.ubutton.webkitEntries && this.ubutton.webkitEntries.length) {
        entries = Array.from(this.ubutton.webkitEntries);
      }
      else {
        files = Array.from(this.ubutton.files);
      }
      this.ubutton.parentElement.reset();
      this.queueUploads(entries, files);
    }
    catch (ex) {
      console.error("failed to handle button upload", ex);
    }
  }
  ondrop(e) {
    e.preventDefault();
    try {
      const files = [];
      const entries = [];
      const {dataTransfer: data} = e;
      if (data.items && data.items.length) {
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
      if (!entries.length) {
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
      sort(files, f => f.name, naturalCaseSort).reverse();
      const uploads = files.
        filter(f => !ROBOCOPFILES.test(f.name)).
        map(f => new Upload(this, f));
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
      f = new File(this, f);
      this.elmap.set(f.el, f);
      this.emit("file-added", f);
      this.emit(`file-added-${f.key}`, f);
      return f;
    });
    this.addFileElements(files);
  }

  onfilesupdated(files) {
    console.log("update", this, files);
    for (const f of files) {
      const existing = this.filemap.get(f.key);
      if (!existing) {
        continue;
      }
      existing.update(f);
    }
  }

  onfilesdeleted(files) {
    console.log("deleted", files);
    for (const f of files) {
      const existing = this.filemap.get(f.key);
      if (!existing) {
        continue;
      }
      existing.remove();
    }
  }

  has(key) {
    return this.filemap.has(key);
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
    this.filemap.clear();
    this.adjustEmpty();
    this.updateFilterStatus();
  }

  adjustEmpty(forceOn) {
    if (!forceOn && this.el.childElementCount) {
      this.el.parentElement.classList.remove("empty");
    }
    else {
      this.el.parentElement.classList.add("empty");
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
        this.filemap = new Map(this.files.map(f => [f.key, f]));
      }
      else {
        this.files.push(...files);
        if (files.length > 5) {
          this.filemap = new Map(this.files.map(f => [f.key, f]));
        }
        else {
          files.forEach(e => this.filemap.set(e.key, e));
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
        this.filemap.delete(f.key);
      }
      this.files = Array.from(this.filemap.values());
      return;
    }
    for (const f of files) {
      if (this.filemap.delete(f.key)) {
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
