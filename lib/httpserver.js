"use strict";

const path = require("path");
const express = require("express");
const ss = require("serve-static");
const {Server} = require("http");
const {Client} = require("./client");
const v = require("./clientversion");
const {token} = require("./util");

const BASE = path.join(__dirname, "..", "static");
const p = path.join.bind(path, BASE);

const PAGES = new Set([
  "rules",
]);

const ss_opts = {
  immutable: true,
  maxAge: 2592000000,
  index: false,
  redirect: false,
};

const app = express();
const server = new Server(app);
const io = require("socket.io")(server, {
  path: "/w",
  transports: ["websocket"],
  serveClient: false,
});

app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("etag", "strong");

app.use(require("compression")());
app.use(require("helmet")({
  hsts: {
    setIf(req) {
      return req.secure;
    }
  },
  xssFilter: false,
  ieNoOpen: false,
}));

app.get("/", function (req, res) {
  res.render("index", {v});
});

app.get("/favicon.ico", function (req, res) {
  res.sendFile(p("favicon.jpg"));
});

app.use("/static", ss(p(), ss_opts));

app.get("/g/:key/:name", require("./upload").serve);
app.get("/g/:key", require("./upload").serve);

app.use(require("cookie-parser")());
app.use(async (req, res, next) => {
  try {
    if (!req.cookies.kft) {
      req.cookies.kft = await token();
      res.cookie("kft", req.cookies.kft, {
        httpOnly: true,
        secure: req.secure,
      });
    }
  }
  catch (ex) {
    console.error(ex);
  }
  next();
});

app.put("/api/upload", require("./upload").upload);

app.get("/r/:roomid", function (req, res) {
  res.render("room", {v});
});

io.on("connection", function (socket) {
  Client.create(socket);
});


app.get("/:page", (req, res, next) => {
  const {page} = req.params;
  if (PAGES.has(page)) {
    res.render(page, {v});
    return;
  }
  next();
});

// eslint-disable-next-line
app.all("*", (req, res, __) => {
  if (res.headerSent) {
    return;
  }
  console.log(req.url, req.originalUrl);
  res.status(404).render("notfound", {v});
});

const {HTTP_PORT = 8080} = process.env;

server.listen(HTTP_PORT, () => {
  console.log(`HTTP ${process.pid.toString().bold} is running`);
});
