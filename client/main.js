"use strict";
/* globals io, localforage */

const registry = require("./registry");

const roomid = document.location.pathname.replace(/^\/r\//, "");

const {Messages} = require("./messages");
const {ChatBox} = require("./chatbox");


function createSocket() {
  const params = new URLSearchParams();
  const nick = localStorage.getItem("nick");
  params.set("roomid", roomid);
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

const socket = registry.socket = createSocket();
const chatbox = registry.chatbox = new ChatBox(roomid);
const msgs = registry.messages = new Messages(roomid);

function setRoomName(name) {
  document.title = `${name} - kregfile`;
  document.querySelector("#name").textContent = name;
}

chatbox.on("error", e => {
  msgs.add({
    volatile: true,
    role: "system",
    user: "Error",
    msg: e
  });
});
chatbox.on("warn", e => {
  msgs.add({
    volatile: true,
    role: "system",
    user: "Warning",
    msg: e
  });
});
msgs.on("message", m => chatbox.autocomplete.add(m));
socket.on("message", msgs.add.bind(msgs));
socket.on("usercount", v => {
  document.querySelector("#usercount").textContent = v;
});
socket.on("config", arr => {
  const cmap = new Map(arr);
  for (const [k, v] of cmap.entries()) {
    if (v === null) {
      registry.config.delete(k);
    }
    else {
      registry.config.set(k, v);
    }
  }
  const rn = cmap.get("roomname");
  if (rn) {
    setRoomName(rn);
  }
});

addEventListener("DOMContentLoaded", function load() {
  removeEventListener("DOMContentLoaded", load, true);
  msgs.restore().catch(console.error);
}, true);
