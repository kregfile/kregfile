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
  serveClient: false,
});

app.disable("x-powered-by");
app.set("etag", "strong");

app.use(require("morgan")("tiny"));
app.use(require("compression")());

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

const {HTTP_PORT = 8080} = process.env;

server.listen(HTTP_PORT, () => {
  console.log(`Listening on port ${server.address().port}`);
  console.log(`Point your browser to http://0.0.0.0:${server.address().port}/r/test`);
});
