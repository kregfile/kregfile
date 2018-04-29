"use strict";
/* eslint max-len: "off" */

export const templates = {
  spamming: {
    text: "Spamming",
    mute: true,
    upload: true,
    hours: 4
  },
  hopping: {
    text: "Spamming (IP Hopping)",
    hellban: true,
    hours: 72
  },
  cp: {
    text: "Child Pornography",
    mute: true,
    upload: true,
    hours: 365 * 24
  },
  greyzone: {
    text: "Grey zone content",
    upload: true,
    hours: 12
  },
  doxing: {
    text: "Doxing (Full names, address and/or locations)",
    upload: true,
    hours: 12
  },
  dmca: {
    text: "Your files have been removed due to a copyright claim by a third party",
    upload: true,
    hours: 1
  },
  bogusreport: {
    text: "Please don't abuse the report function and read the intructions very carefully",
    mute: true,
    hours: 6
  },
};

window.templates = templates;
