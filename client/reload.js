"use strict";

import {randint} from "./util";
import registry from "./registry";

export default function() {
  registry.socket.on("outdated", () => {
    registry.messages.addSystemMessage("OUTDATED CLIENT - reloading soon™️");

    setTimeout(() => {
      location.reload();
    }, randint(500, 2500));
  });
}
