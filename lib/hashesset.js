"use strict";

class HashesSet extends Map {
  // eslint-disable-next-line
  constructor() {
    super();
  }

  has(file) {
    return super.has(file.hash);
  }

  add(file) {
    let hashes = super.get(file.hash);
    if (hashes) {
      hashes.add(file);
      return this;
    }
    hashes = new Set([file]);
    super.set(file.hash, hashes);
    return this;
  }

  update(file) {
    let hashes = super.get(file.hash);
    if (!hashes) {
      super.set(file.hash, new Set([file]));
      return this;
    }
    hashes = new Set(Array.from(hashes).filter(e => e.key !== file.key));
    hashes.add(file);
    super.set(file.hash, hashes);
    return this;
  }

  delete(file) {
    const hashes = super.get(file.hash);
    if (!hashes) {
      return false;
    }
    if (hashes.delete(file)) {
      if (!hashes.size) {
        super.delete(file.hash);
      }
      return true;
    }
    return false;
  }
}

module.exports = { HashesSet };
