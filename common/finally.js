"use strict";

function nothing() {}

if (!Promise.prototype.finally) {
  Object.assign(Promise.prototype, {
    finally(cb) {
      return this.then(function(res) {
        const rv = (cb.call && cb.call()) || cb;
        return Promise.resolve(rv).then(function() {
          return res;
        });
      }, function(e) {
        const rv = (cb.call && cb.call()) || cb;
        return Promise.resolve(rv).then(function() {
          return Promise.reject(e);
        });
      });
    }
  });
}

if (!Promise.prototype.ignore) {
  Object.assign(Promise.prototype, {
    ignore() {
      return this.catch(nothing);
    }
  });
}
