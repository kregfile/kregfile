"use strict";

import Tooltip from "../tooltip";
import { dom, roleToIcon, toPrettyInt, toPrettySize } from "../util";

export default class UserTooltip extends Tooltip {
  constructor(info) {
    super(info.name);
    this.el.classList.add("tooltip-user");
    if (info.gravatar) {
      this.el.appendChild(dom("img", {
        classes: ["tooltip-preview"],
        attrs: {src: info.gravatar}
      }));
    }
    else {
      this.el.appendChild(dom("span", {
        classes: [
          "tooltip-preview",
          roleToIcon(info.role),
          info.role
        ],
      }));
    }

    const add = (t, v) => {
      this.el.appendChild(dom("span", {
        classes: ["tooltip-tag-tag"],
        text: t ? `${t}:` : "",
      }));
      this.el.appendChild(dom("span", {
        classes: ["tooltip-tag-value"],
        text: v
      }));
    };

    switch (info.role) {
    case "mod":
      add("Is a", "Moderator");
      break;

    case "user":
      add("Is a", "User");
      break;
    }
    if (info.owner === "true") {
      add("", "Room Owner");
    }
    if (info.email) {
      add("Email", info.email);
    }
    if (info.uploadStats.filesRank) {
      const {uploadStats: s} = info;
      add("Uploaded", `${toPrettySize(s.uploaded)} (#${toPrettyInt(s.uploadedRank)})`);
      add("Files", `${toPrettyInt(s.files)} (#${toPrettyInt(s.filesRank)})`);
    }
    else {
      add("Uploaded", "Nothing 😢");
    }
  }
}

