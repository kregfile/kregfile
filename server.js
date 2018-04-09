"use strict";

const express = require("express");
const {Server} = require("http");
const {Client} = require("./client");

const app = express();
const server = new Server(app);
const io = require("socket.io")(server, {
  path: "/w",
  transports: ["websocket"],
});

app.use(require("morgan")("tiny"));

app.get("/", function (req, res) {
  res.sendFile(`${__dirname}/static/index.html`);
});
app.get("/r/:roomid", function (req, res) {
  res.sendFile(`${__dirname}/static/room.html`);
});
app.use("/static", express.static("static"));

io.on("connection", function (socket) {
  Client.create(socket);
});

server.listen(8080);
