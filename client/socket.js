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
    reconnectionDelay: 200,
    randomizationFactor: 0.7,
    reconnectionDelayMax: 10000,
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

  let token = null;
  socket.on("token", t => {
    token = t;
  });

  socket.rest = async (endp, params) => {
    params = Object.assign({token}, params);
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    let res = await fetch(`/api/${endp}`, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
      credentials: "same-origin",
    });
    if (!res.ok) {
      throw new Error("Server returned an error");
    }
    res = await res.json();
    if (res && res.err) {
      throw new Error(res.err);
    }
    return res;
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
