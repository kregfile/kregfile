"use strict";

import Removable from "../removable";
import registry from "../registry";
import {
  dom,
  toPrettyDuration,
  toPrettySize,
} from "../util";
import {APOOL} from "../animationpool";

export default class Upload extends Removable {
  constructor(owner, file) {
    super();
    this.owner = owner;
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
          if (this.owner.has(resp.key)) {
            this.remove();
          }
          else {
            let to = 0;
            const rem = () => {
              to = 0;
              this.remove();
            };
            const check = () => {
              if (!to) {
                return;
              }
              if (!this.owner.has(resp.key)) {
                to = setTimeout(check, 1000);
                return;
              }
              this.owner.removeListener(`file-added-${resp.key}`, rem);
              rem();
            };
            to = setTimeout(check, 1000);
            this.owner.once(`file-added-${resp.key}`, rem);
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
