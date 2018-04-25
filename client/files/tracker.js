"use strict";

import registry from "../registry";
import {CoalescedUpdate} from "../util";

export const REMOVALS = new CoalescedUpdate(0, a => {
  registry.files.removeFileElements(a);
});

export const TTL = {
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
    if (e.ttl < 60000 * 2) {
      TTL.PERSEC.add(e);
    }
    else {
      TTL.PERMIN.add(e);
    }
  })),
  PERHOUR: new CoalescedUpdate(3600000, a => a.forEach(e => {
    e.updateTTL();
    if (e.ttl < 3600000 * 2) {
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
