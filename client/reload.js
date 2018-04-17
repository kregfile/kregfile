"use strict";

import registry from "./registry";

export default function() {
  registry.socket.on("outdated", () => {
    registry.messages.add({
      volatile: true,
      user: "System",
      role: "system",
      msg: "OUTDATED CLIENT - reloading"
    });
    setTimeout(() => location.reload(), 1000);
  });
}
