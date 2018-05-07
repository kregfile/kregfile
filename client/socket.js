"use strict";
/* global CLIENT_VERSION */

import io from "socket.io-client";
import registry from "./registry";
import parser from "../common/sioparser";

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
    parser,
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
  Object.defineProperties(socket, {
    clientSeq: {
      enumerable: true,
      get() {
        return socket.io.encoder.seq;
      }
    },
    serverSeq: {
      enumerable: true,
      get() {
        return socket.io.decoder.seq;
      }
    },
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

  socket.on("stoken", s => {
    socket.stoken = s;
  });
  socket.on("reconnecting", () => {
    if (!socket.serverRestartSeq) {
      socket.serverRestartSeq = socket.serverSeq;
      socket.serverSToken = socket.stoken;
    }
  });
  socket.on("reconnect", async () => {
    if (socket.serverRestartSeq) {
      const {serverSToken, serverRestartSeq} = socket;
      socket.serverRestartSeq = 0;
      socket.servetSToken = 0;
      const res = await socket.makeCall(
        "continue", serverSToken, serverRestartSeq);
      if (res) {
        return;
      }
    }
    registry.messages.add({
      volatile: true,
      user: "Connection",
      role: "system",
      msg: "reconnected"
    });
  });

  return socket;
}
