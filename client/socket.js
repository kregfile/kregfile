"use strict";
/* globals io */

const registry = require("./registry");

function createSocket() {
  const params = new URLSearchParams();
  const nick = localStorage.getItem("nick");
  params.set("roomid", registry.roomid);
  if (nick) {
    params.set("nick", nick);
  }
  const socket = io.connect({
    path: "/w",
    query: params.toString(),
    transports: ["websocket"],
  });
  socket.on("connect", console.log);
  socket.on("close", console.log);
  return socket;
}

registry.socket = createSocket();
