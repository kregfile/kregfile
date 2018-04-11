"use strict";

const path = require("path");
const express = require("express");
const {Server} = require("http");
const {Client} = require("./client");

const BASE = path.join(__dirname, "..", "static");
const p = path.join.bind(path, BASE);

const app = express();
const server = new Server(app);
const io = require("socket.io")(server, {
  path: "/w",
  transports: ["websocket"],
});

app.use(require("morgan")("tiny"));

app.get("/", function (req, res) {
  res.sendFile(p("index.html"));
});
app.get("/favicon.ico", function (req, res) {
  res.sendFile(p("favicon.jpg"));
});
app.get("/r/:roomid", function (req, res) {
  res.sendFile(p("room.html"));
});
app.use("/static", express.static(p()));

io.on("connection", function (socket) {
  Client.create(socket);
});

server.listen(8080);
