"use strict";

export async function xregexp(...args) {
  return new (await import(
    /* webpackChunkName: "xregexp", webpackPrefetch: true */
    "xregexp")).default(...args);
}
