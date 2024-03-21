"use strict";
/* global CLIENT_VERSION */

import io from "socket.io-client";
import registry from "./registry";

const {crypto: {subtle: crypto}} = window;

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf.buffer || buf)));
}

async function addVerifier(params, verifier) {
  const key = await crypto.generateKey({
    name: "HMAC",
    hash: "SHA-256",
    length: 9 * 8,
  }, true, ["sign"]);
  const nounce = await crypto.exportKey("raw", key);
  const bnounce = b64(nounce);
  const enc = (new TextEncoder()).encode(verifier);
  const signature = await crypto.sign("HMAC", key, enc);
  const wrapped = b64(signature).
    replace(/=/g, "").replace(/\//g, "_").replace(/\+/g, "-");
  params.append("s", wrapped);
  params.append("n", bnounce);
}

export default async function createSocket() {
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
  const verifier = new URLSearchParams(document.cookie).get("verifier");
  if (verifier) {
    await addVerifier(params, verifier);
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
    const callbackKey = `${target}-${id}`;
    return new Promise((resolve, reject) => {
      try {
        const timeout = setTimeout(() => {
          socket.removeListener(callbackKey);
          reject(new Error("Call timeout"));
        }, 20000);
        const rresolve = rv => {
          clearTimeout(timeout);
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
        socket.once(callbackKey, rresolve);
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

  socket.on("disconnect", () => {
    if (!socket.serverRestartSeq) {
      socket.serverRestartSeq = socket.serverSeq;
      socket.serverSToken = socket.stoken;
    }
  });

  socket.io.on("reconnect_attempt", attempt => {
    if (attempt !== 3) {
      return;
    }
    registry.messages.addSystemMessage("Connection error. Reconnecting...");
  });

  socket.io.on("reconnect", async attempt => {
    socket.emit("nick", registry.chatbox.currentNick);
    try {
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
      if (attempt > 2) {
        registry.messages.addSystemMessage("Connection restored");
      }
    }
    catch (ex) {
      console.error(ex);
    }
  });

  socket.io.on("reconnect_failed", () => {
    registry.messages.addSystemMessage(
      "Couldn't connect! Please manually refresh your tab!");
  });

  return socket;
}
