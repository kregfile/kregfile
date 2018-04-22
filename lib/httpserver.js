"use strict";

const cookie = require("cookie");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const bodyParser = require("body-parser");
const ss = require("serve-static");
const {Server} = require("http");
const {Client} = require("./client");
const v = require("./clientversion");
const {token} = require("./util");
const {User} = require("./user");
const CONFIG = require("./config");

const BASE = path.join(__dirname, "..", "static");
const p = path.join.bind(path, BASE);

const PAGES = new Set([
  "rules",
  "privacy",
]);

const sekrit = CONFIG.get("secret");
const STTL = CONFIG.get("sessionTTL");

function hmactoken(d) {
  return crypto.createHmac("sha1", sekrit).
    update(d).
    digest("base64").slice(0, 10);
}

function rtoken(req) {
  return hmactoken(req.cookies.kft);
}

function rtokenize(fn) {
  return async function(req, res) {
    try {
      const e = hmactoken(req.cookies.kft);
      if (e !== req.body.token) {
        throw new Error("Invalid request token");
      }
      delete req.body.token;
      let rv = fn(req, res);
      if (rv && rv.then) {
        rv = await rv;
      }
      res.json(rv);
    }
    catch (ex) {
      console.error(fn.name || "<wrapped handler>", ex);
      res.json({err: ex.message || ex.toString()});
    }
  };
}

function render(res, page, ctx) {
  ctx = Object.assign({
    v,
    get token() {
      return rtoken(res.req);
    }
  }, ctx);
  return res.render(page, ctx);
}

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

app.get("/favicon.ico", function (req, res) {
  res.sendFile(p("favicon.png"));
});

app.use("/static", ss(p(), ss_opts));

app.get("/g/:key/:name", require("./upload").serve);
app.get("/g/:key", require("./upload").serve);

app.use(require("cookie-parser")());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(async (req, res, next) => {
  try {
    if (!req.cookies) {
      req.cookies = {};
    }
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

app.get("/", function (req, res) {
  render(res, "index", {v});
});


app.put("/api/upload", require("./upload").upload);

app.post("/api/register", rtokenize(async (req, res) => {
  const {u, p} = req.body;
  if (!u || !p) {
    throw new Error("Invalid call");
  }
  const rv = await User.create(req.ip, u, p);
  if (rv.session) {
    req.cookies.session = rv.session;
    res.cookie("session", req.cookies.session, {
      httpOnly: true,
      secure: req.secure,
      maxAge: STTL * 1000,
    });
  }
  return rv;
}));

app.post("/api/login", rtokenize(async (req, res) => {
  const {u, p} = req.body;
  if (!u || !p) {
    throw new Error("Invalid call");
  }
  const rv = await User.login(req.ip, u, p);
  if (rv.session) {
    req.cookies.session = rv.session;
    res.cookie("session", req.cookies.session, {
      httpOnly: true,
      secure: req.secure,
      maxAge: STTL * 1000,
    });
  }
  return rv;
}));

app.post("/api/logout", rtokenize(async (req, res) => {
  if (!req.cookies.session) {
    return null;
  }
  await User.logout(req.cookies.session);
  delete req.cookies.session;
  res.clearCookie("session", {
    httpOnly: true,
    secure: req.secure,
  });
  return null;
}));

app.post("/api/account", rtokenize(async req => {
  const user = req.cookies.session && await User.load(req.cookies.session);
  if (!user) {
    throw new Error("Not logged in!");
  }
  await user.adopt(req.body);
  await user.save();
  return {success: "was suceedingly succesful"};
}));

app.get("/r/:roomid", function (req, res) {
  render(res, "room");
});

app.get("/u/:user", async function (req, res, next) {
  const user = await User.get(req.params.user);
  if (!user) {
    next();
    return;
  }
  render(res, "user", {user});
});

io.on("connection", function (socket) {
  socket.handshake.cookies = cookie.parse(
    socket.handshake.headers.cookie || "");
  Client.create(socket, rtoken(socket.handshake));
});

app.all("/account", async (req, res) => {
  const user = req.cookies.session && await User.load(req.cookies.session);
  if (!user) {
    res.status(403);
    await render(res, "error", {
      error: "You aren't logged in!"
    });
    return;
  }
  render(res, "account", {
    user
  });
});

app.all("/register", async (req, res) => {
  const user = req.cookies.session && await User.load(req.cookies.session);
  if (user) {
    res.status(403);
    await render(res, "error", {
      error: "You are already logged in!"
    });
    return;
  }
  render(res, "register");
});

app.get("/:page", (req, res, next) => {
  const {page} = req.params;
  if (PAGES.has(page)) {
    return render(res, page);
  }
  return next();
});

// eslint-disable-next-line
app.all("*", (req, res, __) => {
  if (res.headerSent) {
    return;
  }
  res.status(404).render("notfound", {v});
});

const {HTTP_PORT = 8080} = process.env;

server.listen({
  port: HTTP_PORT,
  host: "0.0.0.0"
}, () => {
  console.log(`HTTP ${process.pid.toString().bold} is running`);
});
