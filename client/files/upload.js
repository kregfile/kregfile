"use strict";

import Removable from "../removable";
import registry from "../registry";
import {
  dom,
  toPrettyDuration,
  toPrettyETA,
  toPrettySize,
} from "../util";
import {APOOL} from "../animationpool";

// eslint-disable-next-line
const PER = new Intl.NumberFormat(undefined, {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

let IDS = 0;

export default class Upload extends Removable {
  constructor(owner, file) {
    super();
    this.owner = owner;
    this.file = file;
    this.key = null;
    this.offset = null;
    this.req = null;
    this.aborted = false;
    this.id = ++IDS;

    this.el = dom("div", {classes: ["file", "upload"]});

    this.iconEl = dom("span", {
      classes: ["icon", "i-wait"],
    });
    this.el.appendChild(this.iconEl);

    this.abortEl = dom("span", {
      classes: ["icon", "abort", "i-clear"],
      attrs: {title: "Cancel Upload"},
    });
    this.el.appendChild(this.abortEl);
    this.abortEl.onclick = this.abort.bind(this);

    this.nameEl = dom("span", {classes: ["name"], text: this.file.name});
    this.el.appendChild(this.nameEl);

    this.progressEl = dom("span", {classes: ["detail-progress"]});
    this.el.appendChild(this.progressEl);

    this.detailEl = dom("span", {classes: ["detail"]});
    this.el.appendChild(this.detailEl);

    this.sizeEl = dom("span", {
      classes: ["size"],
      text: toPrettySize(this.file.size)
    });
    this.detailEl.appendChild(this.sizeEl);
  }

  getKey() {
    const {socket} = registry;
    let inlineTO = null;
    const getter = (resolve, reject) => {
      socket.makeCall("uploadkey", this.id).then(d => {
        if (inlineTO) {
          clearInterval(inlineTO);
          inlineTO = null;
        }
        if (!d.wait) {
          resolve(d);
          return;
        }

        const updateDuration = dur => this.sizeEl.textContent = `Waiting (${toPrettyDuration(dur)})`;
        resolve(new Promise((iresolve, ireject) => {
          let dur = registry.roomie.diffTimes(d.wait);
          if (dur <= 0) {
            getter(iresolve, ireject);
            return;
          }
          updateDuration(dur);
          inlineTO = setInterval(() => {
            dur -= 1000;
            updateDuration(dur);
          }, 1000);
          setTimeout(() => {
            getter(iresolve, ireject);
          }, Math.min(dur, 20000));
        }));
        return;
      }).catch(reject);
    };
    const rv = new Promise(getter);
    (rv.finally || rv.catch).call(rv, () => {
      if (inlineTO) {
        clearInterval(inlineTO);
      }
    });
    return rv;
  }

  queryOffset() {
    const {socket} = registry;
    return socket.makeCall("queryoffset", this.key);
  }

  abort() {
    this.aborted = true;
    this.remove();
    if (!this.req) {
      return;
    }
    this.req.abort();
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
    params.set("offset", this.offset);
    params.set("now", Date.now());
    try {
      const req = this.req = new XMLHttpRequest();
      return await new Promise((resolve, reject) => {
        req.onerror = () => {
          console.error("onerror");
          const err = new Error("Connection lost");
          err.retryable = true;
          reject(err);
        };
        req.onabort = () => {
          reject(new Error("Aborted"));
        };
        req.onload = () => {
          resolve(req.response);
        };
        req.responseType = "json";
        let last = Date.now();
        let bytes = 0;
        let rate = 0;
        req.upload.addEventListener("progress", e => {
          const now = Date.now();
          const diff = Date.now() - last;
          if (diff > 1000 || !rate) {
            const cur = (e.loaded - bytes) / diff * 1000;
            bytes = e.loaded;
            rate = cur * 0.3 + rate * 0.7;
            last = now;
          }
          this.setProgress(this.offset + e.loaded, this.offset + e.total, rate);
        }, { passive: true });
        req.open("PUT", `/api/upload/${this.key}?${params.toString()}`);
        let {file} = this;
        if (this.offset) {
          file = file.slice(this.offset);
        }
        req.send(file);
      });
    }
    finally {
      this.req = null;
    }
  }

  setProgress(current, total, rate) {
    const p = (current / total);
    if (p !== 1) {
      const eta = toPrettyETA((total - current) / rate * 1.01);
      rate = `${toPrettySize(rate)}/s`;
      this.progressEl.textContent = `ETA: ${eta} — ${PER.format(p)}`;
      this.sizeEl.textContent = `${toPrettySize(current)}/${toPrettySize(total)} — ${rate}`;
    }
    else {
      this.progressEl.textContent = "";
      this.sizeEl.textContent = `${toPrettySize(this.file.size)} - Finishing...`;
    }
    this.el.style.backgroundSize = `${p * 100}% 100%`;
  }

  setIcon(cls) {
    this.iconEl.classList.remove(
      "i-wait", "i-upload", "i-upload-done", "i-error");
    this.iconEl.classList.add(cls);
  }

  async upload() {
    if (this.aborted) {
      return;
    }
    await registry.chatbox.ensureNick();
    this.setIcon("i-upload");
    try {
      const maxFileSize = registry.config.get("maxFileSize");
      if (maxFileSize && this.file.size && this.file.size > maxFileSize) {
        throw Object.assign(new Error(`File is too large, limit is ${toPrettySize(maxFileSize)}`), {code: 5});
      }
      for (let i = 0; i <= 25; ++i) {
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
          if (this.owner.has(resp.key)) {
            this.remove();
          }
          else {
            this.owner.once(`file-added-${resp.key}`, () => {
              this.remove();
            });
          }
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
      if (this.aborted) {
        return;
      }
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

Upload.prototype.setIcon = APOOL.wrap(Upload.prototype.setIcon);
