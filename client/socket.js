"use strict";
/* global CLIENT_VERSION */

import io from "socket.io-client";
import registry from "./registry";

export default function createSocket() {
  const params = new URLSearchParams();
  const nick = localStorage.getItem("nick");
  params.set("roomid", registry.roomid);
  const sc = document.querySelector("script[src*='client']");
  const url = new URL(sc.getAttribute("src"), document.location);
  const cv = url.searchParams.get("v");
  params.set("cv", cv);
  if (nick) {
    params.set("nick", nick);
  }
  const socket = io.connect({
    path: "/w",
    query: params.toString(),
    transports: ["websocket"],
  });
  socket.makeCall = (target, id, ...args) => {
    return new Promise((resolve, reject) => {
      try {
        const rresolve = rv => {
          if (rv && rv.err) {
            reject(new Error(rv.err));
            return;
          }
          resolve(rv);
        };
        if (!id) {
          socket.once(target, rresolve);
          socket.emit(target);
        }
        socket.once(`${target}-${id}`, rresolve);
        socket.emit(target, id, ...args);
      }
      catch (ex) {
        reject(ex);
      }
    });
  };

  socket.on("reconnect", () => {
    registry.messages.add({
      volatile: true,
      user: "Connection",
      role: "system",
      msg: "reconnected"
    });
  });

  return socket;
}
