"use strict";

const cookie = require("cookie");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const bodyParser = require("body-parser");
const ss = require("serve-static");
const {createServer} = require("http");
const {createServer: createTLSServer} = require("https");
const {Client} = require("./client");
const {Room} = require("./room");
const v = require("./clientversion");
const {token, toPrettySize, toPrettyInt} = require("./util");
const {Stats, User} = require("./user");
const CONFIG = require("./config");

const BASE = path.join(__dirname, "..", "static");
const p = path.join.bind(path, BASE);

const PAGES = new Set([
  "rules",
  "privacy",
]);

const NAME = CONFIG.get("name");

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
    NAME,
    v,
    get token() {
      return rtoken(res.req);
    }
  }, ctx);
  return res.render(page, ctx);
}

async function injectkft(req, res, next) {
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
  if (next) {
    next();
  }
}

async function getUser(req, _, next) {
  const user = req.cookies.session &&
    await User.load(req.cookies.session);
  req.user = user || null;
  if (next) {
    next();
  }
}

const ss_opts = {
  immutable: true,
  maxAge: 2592000000,
  index: false,
  redirect: false,
};

const app = express();
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

app.use(require("cookie-parser")());

app.get("/g/:key/:name", getUser, require("./upload").serve);
app.get("/g/:key", getUser, require("./upload").serve);

app.use(injectkft);

app.get("/", function (req, res) {
  render(res, "index", {v});
});

app.put("/api/upload", getUser, require("./upload").upload);

app.post("*", bodyParser.json());

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
  const {u, p, t} = req.body;
  if (!u || !p) {
    throw new Error("Invalid call");
  }
  const rv = await User.login(req.ip, u, p, t);
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

app.use(getUser);

app.post("/api/account", rtokenize(async req => {
  const {user} = req;
  if (!user) {
    throw new Error("Not logged in!");
  }
  switch (req.body.realm) {
  case "acct":
    return await user.adopt(req.body);

  case "tfa":
    return await user.setTwofactor(req.body);

  default:
    throw new Error("Invalid realm!");
  }
}));

async function newRoom(req, res, next) {
  const {user} = req;
  const room = await Room.create(req.ip, user, rtoken(req));
  if (!room) {
    next();
    return;
  }
  res.redirect(`/r/${room.roomid}`);
}

app.get("/new", newRoom);
app.get("/r/new", newRoom);

app.get("/r/:roomid", async function (req, res, next) {
  if (!await Room.get(req.params.roomid)) {
    next();
    return;
  }
  render(res, "room");
});

app.get("/u/:user", async function (req, res, next) {
  const user = await User.get(req.params.user);
  if (!user) {
    next();
    return;
  }
  const info = Object.create(await user.getInfo());
  if (info.uploadStats.filesRank) {
    const {uploadStats: s} = info;
    info.uploaded = toPrettySize(s.uploaded);
    info.uploadedRank = `#${toPrettyInt(s.uploadedRank)}`;
    info.files = toPrettyInt(s.files);
    info.filesRank = `#${toPrettyInt(s.filesRank)}`;
  }
  render(res, "user", {user, info});
});

app.all("/account", async (req, res) => {
  const {user} = req;
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
  const {user} = req;
  if (user) {
    res.status(403);
    await render(res, "error", {
      error: "You are already logged in!"
    });
    return;
  }
  render(res, "register");
});

app.get("/top/:list/:page?", async (req, res, next) => {
  const {list} = req.params;
  if (list !== "uploaded" && list !== "files") {
    next();
    return;
  }
  let {page} = req.params;
  page = parseInt(page, 10) || 0;
  try {
    render(res, "toplist", {
      list,
      stats: await Stats.get(list, page)
    });
  }
  catch (ex) {
    console.error(ex);
    next();
  }
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
  res.status(404);
  render(res, "notfound");
});


function setupWS(server) {
  const io = require("socket.io")(server, {
    path: "/w",
    transports: ["websocket"],
    serveClient: false,
  });

  io.use(async (socket, next) => {
    socket.handshake.cookies = cookie.parse(
      socket.handshake.headers.cookie || "");
    if (!socket.handshake.cookies.kft) {
      next(new Error("Invalid kft"));
      return;
    }
    const {roomid} = socket.handshake.query;
    socket.room = await Room.get(roomid);
    if (!socket.room) {
      next(new Error("Invalid room"));
      return;
    }
    next();
  });

  io.on("connection", function(socket) {
    Client.create(socket, rtoken(socket.handshake));
  });
}


if (!CONFIG.get("tlsonly")) {
  const server = createServer(app);
  setupWS(server);
  server.listen({
    port: CONFIG.get("port"),
    host: "0.0.0.0"
  }, () => {
    console.log(`HTTP ${process.pid.toString().bold} is running on port ${CONFIG.get("port")}`);
  });
}

if (CONFIG.get("tls")) {
  const server = createTLSServer({
    cert: fs.readFileSync(CONFIG.get("tlscert")),
    key: fs.readFileSync(CONFIG.get("tlskey")),
  }, app);
  setupWS(server);
  server.listen({
    port: CONFIG.get("tlsport"),
    host: "0.0.0.0",
  }, () => {
    console.log(`HTTPS ${process.pid.toString().bold} is running on port ${CONFIG.get("tlsport")}`);
  });
}
