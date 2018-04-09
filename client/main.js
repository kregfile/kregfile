"use strict";
/* globals io, localforage */

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

const config = {};
const socket = createSocket();
const chatbox = new ChatBox(roomid, socket);
const msgs = new Messages(roomid);

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
socket.on("config", c => {
  for (const [k, v] of Object.entries(c)) {
    switch (k) {
    case "name":
      setRoomName(v);
      break;
    }
  }
  Object.assign(config, c);
});

addEventListener("DOMContentLoaded", function load() {
  removeEventListener("DOMContentLoaded", load, true);
  msgs.restore().catch(console.error);
}, true);
