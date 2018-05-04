"use strict";

import EventEmitter from "events";
import registry from "./registry";
import * as filesfilter from "./files/filter";
import {
  PromisePool,
  debounce,
  dom,
  idle,
  iter,
  naturalCaseSort,
  riter,
  sort,
} from "./util";
import {APOOL} from "./animationpool";
import {REMOVALS} from "./files/tracker";
import Upload from "./files/upload";
import File from "./files/file";
import Gallery from "./files/gallery";
import ScrollState from "./files/scrollstate";
import Scroller from "./scroller";

const ROBOCOPFILES =
  /^(?:thumbs.*\.db|\.ds_store.*|.*\.ds_store|.\tthn|desktop.*.ini)$/i;

export default new class Files extends EventEmitter {
  constructor() {
    super();
    this.el = document.querySelector("#files");
    this.scroller = new Scroller(
      this.el, document.querySelector("#filelist-scroller"));
    this.ubutton = document.querySelector("#upload-button");
    this.gallery = new Gallery(this);
    this.filterButtons = Array.from(document.querySelectorAll(".filterbtn"));
    this.filterFunc = null;
    this.filter = document.querySelector("#filter");
    this.filterClear = document.querySelector("#filter-clear");
    this.filterStatus = document.querySelector("#filter-status");
    this.newStatus = document.querySelector("#new-status");
    this.files = [];
    this.filemap = new Map();
    this.elmap = new WeakMap();
    this.scrollState = new ScrollState(this);
    this.newFiles = false;
    this.selectionStart = null;

    this.onfiles = this.onfiles.bind(this);
    this.filesQueue = [];
    this.onfilesdeleted = this.onfilesdeleted.bind(this);
    this.onfilesupdated = this.onfilesupdated.bind(this);
    this.applying = null;
    this.clear = APOOL.wrap(this.clear);
    this.insertFilesIntoDOM = APOOL.wrap(this.insertFilesIntoDOM);
    this.addUploadElements = APOOL.wrap(this.addUploadElements);
    this.uploadOne = PromisePool.wrapNew(1, this, this.uploadOne);
    this.delayedUpdateStatus = debounce(
      idle(this.updateStatus.bind(this)), 100);
    this.setFileStyle = idle(this.setFileStyle);
    this.onfilterbutton = this.onfilterbutton.bind(this);
    this.onuploadbutton = this.onuploadbutton.bind(this);
    this.ondragenter = this.ondragenter.bind(this);
    this.ondragleave = this.ondragleave.bind(this);
    this.dragging = false;
    Object.seal(this);

    addEventListener("drop", this.ondrop.bind(this), true);
    addEventListener("dragenter", this.ondragenter, true);
    addEventListener("dragover", this.ondragenter, true);
    addEventListener("dragleave", this.ondragleave, true);
    addEventListener("mouseout", this.ondragleave, true);

    this.filterButtons.forEach(e => {
      e.addEventListener("click", this.onfilterbutton, true);
      e.addEventListener("contextmenu", this.onfilterbutton, true);
    });
    this.filter.addEventListener(
      "input", debounce(idle(this.onfilter.bind(this), 2000), 200));
    this.filterClear.addEventListener(
      "click", this.clearFilter.bind(this), true);

    this.ubutton.addEventListener("change", this.onuploadbutton.bind(this));

    this.newStatus.addEventListener("click", () => {
      this.el.scrollTop = 0;
      this.delayedUpdateStatus();
    });

    this.el.addEventListener("click", this.onclick.bind(this));
    this.el.addEventListener("contextmenu", this.onclick.bind(this));
    this.el.addEventListener("scroll", this.onscroll.bind(this));

    document.querySelector("#clearselection").addEventListener(
      "click", this.clearSelection.bind(this));

    const actions = [
      "banFiles", "unbanFiles",
      "whitelist", "blacklist",
      "trash"];
    for (const a of actions) {
      document.querySelector(`#${a.toLowerCase()}`).addEventListener(
        "click", this[a].bind(this));
    }
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
    registry.roomie.on("tooltip-hidden", () => this.adjustEmpty());
  }

  onclick(e) {
    const {target: el} = e;
    if (el.classList.contains("tag")) {
      e.preventDefault();
      e.stopPropagation();
      const {tag, tagValue} = el.dataset;
      let val = /[\s'"]/.test(tagValue) ?
        `'${tagValue.replace(/'/g, "\\'")}'` :
        tagValue;
      if (val === "true") {
        val = "";
      }
      if (e.button || e.shiftKey) {
        this.filter.value = `${this.filter.value} -${tag}:${val}`.trim();
      }
      else {
        this.filter.value = `${tag}:${val}`.trim();
      }
      this.doFilter();
      return false;
    }
    return true;
  }

  onscroll() {
    this.delayedUpdateStatus();
    registry.roomie.hideTooltip();
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
      return [];
    }
    if (filterFunc) {
      return files.filter(filterFunc);
    }
    return files;
  }

  applyFilter() {
    const files = this.filtered(this.files);
    if (!files || !files.length) {
      return APOOL.schedule(null, () => {
        this.visible.forEach(e => e.el.parentElement.removeChild(e.el));
      });
    }

    const {visible} = this;
    const fileset = new Set(files);
    // Remove now hidden
    let diff = false;
    const remove = [];
    visible.forEach(e => {
      if (fileset.has(e)) {
        return;
      }
      diff = true;
      remove.push(e.el);
    });
    // unchanged
    if (visible.length === fileset.size && !diff) {
      return Promise.resolve();
    }

    // Add all matching files
    this.adjustEmpty();
    this.scrollState.push();
    return this.insertFilesIntoDOM(files, remove).then(async () => {
      this.sortFiles();
      this.adjustEmpty();
      await this.scrollState.pop();
      this.delayedUpdateStatus();
    });
  }

  openGallery(file) {
    registry.roomie.hideTooltip();
    this.gallery.open(file);
  }

  maybeCloseGallery(file) {
    this.gallery.maybeClose(file);
  }

  updateStatus() {
    if (!this.files.length) {
      this.filterStatus.classList.add("hidden");
    }
    else {
      const text = `${this.visible.length} of ${this.files.length} files`;
      if (this.filterStatus.textContent !== text) {
        this.filterStatus.textContent = text;
      }
      this.filterStatus.classList.remove("hidden");
    }

    if (!this.el.scrollTop) {
      this.newFiles = false;
    }

    if (!this.newFiles) {
      this.newStatus.classList.add("hidden");
    }
    else {
      this.newStatus.classList.remove("hidden");
    }
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

  ondragenter(e) {
    registry.roomie.hideTooltip();
    if (!e.dataTransfer.types.includes("Files")) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (!this.dragging) {
      this.adjustEmpty(true);
      this.dragging = true;
    }
  }

  ondragleave(e) {
    if (e.relatedTarget) {
      return;
    }
    this.dragging = false;
    this.adjustEmpty();
  }

  ondrop(e) {
    this.dragging = false;
    this.adjustEmpty();
    if (!e.dataTransfer.types.includes("Files")) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
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
      console.log(entries, files);
      this.queueUploads(entries, files);
    }
    catch (ex) {
      console.error("failed to handle drop", ex);
    }
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
      await this.addUploadElements(uploads);
      this.adjustEmpty();
      uploads[0].el.scrollIntoView(false);
    }
    catch (ex) {
      console.error(ex);
    }
  }

  onfiles(data) {
    this.filesQueue.push(data);
    if (this.filesQueue.length === 1) {
      this.runOnFiles();
    }
  }

  async runOnFiles() {
    while (this.filesQueue.length) {
      const ridx = this.filesQueue.findIndex((e, i) => i && e.replace);
      if (ridx > 0) {
        // drop everything before
        this.filesQueue.splice(0, ridx);
        continue;
      }
      const data = this.filesQueue.shift();

      const {replace = false} = data;
      if (replace) {
        await this.clear();
      }
      const files = data.files.
        filter(f => {
          const existing = this.filemap.get(f.key);
          if (!existing) {
            return true;
          }
          existing.update(f);
          return false;
        }).
        map(f => {
          f = new File(this, f);
          if (f.expired) {
            return null;
          }
          this.elmap.set(f.el, f);
          this.emit("file-added", f, replace);
          this.emit(`file-added-${f.key}`, f, replace);
          return f;
        }).filter(e => e);
      if (files.length) {
        await this.addFileElements(files);
      }
      if (replace) {
        this.emit("replaced");
      }
    }
    this.sortFiles();
  }

  onfilesupdated(files) {
    for (const f of files) {
      const existing = this.filemap.get(f.key);
      if (!existing) {
        continue;
      }
      existing.update(f);
    }
  }

  onfilesdeleted(files) {
    for (const key of files) {
      const existing = this.filemap.get(key);
      if (!existing) {
        continue;
      }
      existing.remove();
    }
  }

  get(key) {
    return this.filemap.get(key);
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
    this.files = [];
    this.filemap.clear();
    this.adjustEmpty();
    this.updateStatus();
  }

  adjustEmpty(forceOn) {
    if (!forceOn && this.el.childElementCount) {
      document.body.classList.remove("empty");
    }
    else {
      document.body.classList.add("empty");
    }
  }

  setFileStyle(file) {
    if (document.location.hostname === "localhost") {
      return;
    }
    const rules = [];
    const height = getComputedStyle(file.el, null).
      getPropertyValue("height");
    rules.push(`#files > .file { height: ${height}; }`);
    const nameHeight = getComputedStyle(file.nameEl, null).
      getPropertyValue("height");
    rules.push(`#files > .file > .name { height: ${nameHeight}; }`);
    const iconHeight = getComputedStyle(file.iconEl, null).
      getPropertyValue("height");
    rules.push(`#files > .file > .icon { height: ${iconHeight}; }`);
    const tagsHeight = getComputedStyle(file.tagsEl, null).
      getPropertyValue("height");
    rules.push(`#files > .file > .tags { height: ${tagsHeight}; }`);
    const detailHeight = getComputedStyle(file.detailEl, null).
      getPropertyValue("height");
    rules.push(`#files > .file > .detail { height: ${detailHeight}; }`);
    document.body.appendChild(dom("style", {
      text: rules.join("\n")
    }));
    this.setFileStyle = function() {};
  }

  insertFilesIntoDOM(files, remove) {
    if (remove) {
      remove.forEach(el => el.parentElement.removeChild(el));
    }
    let head = document.querySelector(".file:not(.upload)");
    for (const f of this.filtered(files)) {
      if (head) {
        this.el.insertBefore(f.el, head);
      }
      else {
        this.el.appendChild(f.el);
        this.setFileStyle(f);
      }
      head = f.el;
    }
  }

  async addFileElements(files) {
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
      this.adjustEmpty();
      this.scrollState.push();
      await this.insertFilesIntoDOM(files);
      this.adjustEmpty();
      await this.scrollState.pop();
      if (!this.newFiles) {
        const {scrollTop, offsetTop: ot} = this.el;
        for (const file of files) {
          const {offsetHeight, offsetTop} = file.el;
          const top = offsetTop - ot;
          const bottom = top + offsetHeight;
          if (bottom <= scrollTop) {
            this.newFiles = true;
          }
        }
      }
      this.delayedUpdateStatus();
    }
    catch (ex) {
      console.error(ex);
    }
  }

  sortFiles() {
    const {visible} = this;
    if (!visible.length) {
      return;
    }
    const [head] = visible;
    sort(visible, e => e.uploaded).
      reverse();
    let idx = 0;
    const {el} = this;
    for (; idx < el.childElementCount; ++idx) {
      if (el.children[idx] === head.el) {
        break;
      }
    }
    for (const v of visible) {
      if (el.children[idx] === v.el) {
        ++idx;
        continue;
      }
      el.insertBefore(v.el, el.children[idx]);
      ++idx;
    }
  }

  iterfrom(file) {
    const idx = this.files.indexOf(file);
    if (idx < 0) {
      return null;
    }
    return iter(this.files, idx);
  }

  riterfrom(file) {
    const idx = this.files.indexOf(file);
    if (idx < 0) {
      return null;
    }
    return riter(this.files, idx);
  }

  removeFileElements(files) {
    try {
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
    }
    finally {
      this.adjustEmpty();
      this.delayedUpdateStatus();
    }
  }

  addUploadElements(uploads) {
    try {
      for (const u of uploads) {
        this.el.insertBefore(u.el, this.el.firstChild);
      }
    }
    catch (ex) {
      console.error(ex);
    }
  }

  get selection() {
    return Array.from(document.querySelectorAll(".file.selected")).
      map(e => this.elmap.get(e)).
      filter(e => e);
  }

  select(file, e) {
    const {metaKey: meta, ctrlKey: ctrl, shiftKey: shift} = e;
    // Windows style of engagement
    if (shift) {
      const {visible} = this;
      let startIdx;
      if (!this.selectionStart) {
        [this.selectionStart] = visible;
        startIdx = 0;
      }
      else {
        startIdx = visible.indexOf(this.selectionStart);
        if (startIdx < 0) {
          [this.selectionStart] = visible;
          startIdx = 0;
        }
      }
      let endIdx = visible.indexOf(file);
      if (startIdx > endIdx) {
        [startIdx, endIdx] = [endIdx, startIdx];
      }
      this._clearSelection();
      visible.slice(startIdx, endIdx + 1).
        forEach(e => e.el.classList.add("selected"));
    }
    else if (ctrl || meta) {
      file.el.classList.toggle("selected");
    }
    else {
      const already = file.el.classList.contains("selected");
      this._clearSelection();
      if (!already) {
        file.el.classList.add("selected");
        this.selectionStart = file;
      }
      else {
        this.selectionStart = null;
      }
    }
  }

  _clearSelection() {
    this.selection.forEach(e => e.el.classList.remove("selected"));
  }

  clearSelection() {
    this.selectionStart = null;
    this._clearSelection();
  }

  trash() {
    const {selection} = this;
    if (!selection.length) {
      registry.messages.add({
        user: "System",
        volatile: true,
        role: "system",
        msg: "Select some files by (shift-, ctrl-)clicking on their icon first"
      });
      return;
    }
    this.clearSelection();
    this.trashFiles(selection);
  }

  trashFiles(files) {
    registry.socket.emit("trash", files.map(e => e.key).filter(e => e));
  }

  subjectsFromSelection() {
    const {selection} = this;
    const subjects = {
      ips: [],
      accounts: []
    };
    if (!selection.length) {
      return subjects;
    }
    selection.forEach(f => {
      if (f.ip) {
        subjects.ips.push(f.ip);
      }
      if (f.meta && f.meta.account) {
        subjects.accounts.push(f.meta.account);
      }
    });
    subjects.ips = Array.from(new Set(subjects.ips));
    subjects.accounts = Array.from(new Set(subjects.accounts));
    return subjects;
  }

  banFiles() {
    const subjects = this.subjectsFromSelection();
    registry.roomie.showBanModal(subjects, "greyzone");
  }

  unbanFiles() {
    const subjects = this.subjectsFromSelection();
    registry.roomie.showUnbanModal(subjects);
  }

  blacklist() {
    const selected = this.selection.
      map(e => e.key);
    if (!selected.length) {
      return;
    }
    registry.roomie.showBlacklistModal(selected);
  }

  whitelist() {
    const selected = this.selection.
      filter(e => e.tagsMap.has("hidden")).
      map(e => e.key);
    if (!selected.length) {
      return;
    }
    registry.socket.emit("whitelist", selected);
  }

  purgeFrom(subjects) {
    const ips = new Set(subjects.ips);
    const accounts = new Set(subjects.accounts);
    const a = accounts.size > 0;
    const purges = this.files.filter(f => {
      return ips.has(f.ip) || (a && f.meta && accounts.has(f.meta.account));
    });
    this.trashFiles(purges);
  }

  async uploadOne(u) {
    await u.upload();
  }
}();
