"use strict";

import {randint} from "./util";
import registry from "./registry";

export default function() {
  registry.socket.on("outdated", () => {
    registry.messages.add({
      volatile: true,
      user: "System",
      role: "system",
      msg: "OUTDATED CLIENT - reloading soon™️"
    });

    setTimeout(() => {
      location.reload();
    }, randint(500, 2500));
  });
}
