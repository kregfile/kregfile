"use strict";

const cookie = require("cookie");
const fs = require("fs");
const path = require("path");
const {createServer} = require("http");
const {createServer: createTLSServer} = require("https");
const express = require("express");
const bodyParser = require("body-parser");
const ss = require("serve-static");
const sio = require("socket.io");
const {Client} = require("./client");
const {Room} = require("./room");
const v = require("./clientversion");
const verifier = require("./sessionverifier");
const {token, toPrettySize, toPrettyInt} = require("./util");
const {Stats, User} = require("./user");
const CONFIG = require("./config");

const BASE = path.join(__dirname, "..", "static");
const p = path.join.bind(path, BASE);

const PAGES = new Set([
  "terms",
  "rules",
]);

const NAME = CONFIG.get("name");
const MOTTO = CONFIG.get("motto");

const sekrit = CONFIG.get("secret");
const STTL = CONFIG.get("sessionTTL");

function hmactoken(d) {
  return d ? verifier.generate(sekrit, d) : "";
}

function rtoken(req) {
  return hmactoken(req.cookies && req.cookies.kft);
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
    MOTTO,
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
        sameSite: "Strict",
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

function aroute(fn) {
  return async function(req, res, next) {
    try {
      return await fn(req, res, next);
    }
    catch (ex) {
      return next && next(ex);
    }
  };
}

function requireMod(req) {
  if (!req.user || req.user.role !== "mod") {
    throw new Error("Not authorized");
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
if (CONFIG.get("considerProxyForwardedForHeaders")) {
  app.enable("trust proxy");
}
app.set("view engine", "ejs");
app.set("etag", "strong");

if (app.get("env") === "production") {
  app.use(require("compression")());
}
app.use(require("helmet")({
  hsts: {
    setIf(req) {
      return req.secure;
    }
  },
  xssFilter: false,
  ieNoOpen: false,
}));

app.use(require("cookie-parser")());

app.get("/g/:key/:name", getUser, require("./upload").serve);
app.get("/g/:key", getUser, require("./upload").serve);

app.use(injectkft);

// CSP
app.use(function(req, res, next) {
  // Use a reasonable strict/lenient balance
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' 'unsafe-inline'; img-src *; media-src *");
  next();
});

app.get("/", function (req, res) {
  render(res, "index", {v});
});

app.put("/api/upload/:key", getUser, require("./upload").upload);

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
    req.cookies.verifier = verifier.generate(sekrit, rv.session);
    res.cookie("verifier", req.cookies.verifier, {
      httpOnly: false,
      secure: req.secure,
      maxAge: STTL * 1000,
      sameSite: "Strict",
    });
    res.cookie("session", req.cookies.session, {
      httpOnly: true,
      secure: req.secure,
      maxAge: STTL * 1000,
      sameSite: "Strict",
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

app.post("/api/changepw", rtokenize(async req => {
  const {user} = req;
  if (!user) {
    throw new Error("Not logged in!");
  }

  const {c, p, t} = req.body;
  if (!c || !p) {
    throw new Error("Invalid call");
  }

  const rv = await user.changePassword(req.ip, c, p, t);
  return rv;
}));


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

app.get("/new", aroute(newRoom));
app.get("/r/new", aroute(newRoom));

app.get("/r/:roomid", aroute(async function (req, res, next) {
  const room = await Room.get(req.params.roomid);
  if (!room) {
    next();
    return;
  }
  if (room.config.get("inviteonly")) {
    if (!req.user || req.user.role !== "mod") {
      const token = rtoken(req);
      if (!room.invited(req.user, token)) {
        next(new Error("You're not invited!"));
        return;
      }
    }
  }
  render(res, "room");
}));

app.get("/u/:user", aroute(async function (req, res, next) {
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
  render(res, "user", {
    pagename: `User ${user.name}`,
    user,
    info
  });
}));

app.all("/account", (req, res, next) => {
  const {user} = req;
  if (!user) {
    next(new Error("You are not logged in!"));
    return;
  }
  render(res, "account", {
    pagename: "Your Account",
    user
  });
});

app.all("/register", (req, res, next) => {
  const {user} = req;
  if (user) {
    next(new Error("You are already logged in!"));
    return;
  }
  render(res, "register", {
    pagename: "Register",
  });
});

app.get("/top/:list/:page?", aroute(async (req, res, next) => {
  const {list} = req.params;
  if (list !== "uploaded" && list !== "files") {
    next();
    return;
  }
  let {page} = req.params;
  page = parseInt(page, 10) || 0;
  try {
    render(res, "toplist", {
      pagename: "Top of the Crop",
      list,
      stats: await Stats.get(list, page)
    });
  }
  catch (ex) {
    console.error(ex);
    next();
  }
}));

app.get("/adiscover", aroute(async (req, res) => {
  requireMod(req);
  const rooms = (await Room.list()).
    filter(r => r.users || r.files);
  const users = rooms.reduce((p, c) => p + c.users, 0);
  const files = rooms.reduce((p, c) => p + c.files, 0);
  render(res, "discover", {
    pagename: "Discover",
    rooms,
    users,
    files,
  });
}));

app.get("/modlog/revert/:id", aroute(async (req, res, next) => {
  requireMod(req);
  const record = await require("./bans").lookupLog(req.params.id);
  if (!record || !record.revert) {
    next(new Error("Record not found"));
    return;
  }
  const newrecord = await record.revert(req.user);
  if (!newrecord) {
    next(new Error("Nothing to be done!"));
    return;
  }
  res.redirect(`/modlog/${newrecord.id}`);
}));

app.get("/modlog/:id", aroute(async (req, res, next) => {
  requireMod(req);
  const record = await require("./bans").lookupLog(req.params.id);
  if (!record) {
    next();
    return;
  }
  if (record.files) {
    record.files.forEach(f => {
      f.fmtSize = toPrettySize(f.size);
    });
  }
  render(res, "modlogdetail", {
    pagename: "Moderation Log",
    record,
  });
}));

app.get("/modlog", aroute(async (req, res) => {
  requireMod(req);
  const records = await require("./bans").getModLogs();
  render(res, "modlog", {
    pagename: "Moderation Log",
    records,
  });
}));

app.get("/:page", (req, res, next) => {
  const {page} = req.params;
  if (PAGES.has(page)) {
    return render(res, page);
  }
  return next();
});

app.use("/", ss(p(), ss_opts));

// eslint-disable-next-line
app.all("*", (req, res, __) => {
  if (res.headerSent) {
    return;
  }
  res.status(404);
  render(res, "notfound", {
    pagename: "404",
  });
});

// eslint-disable-next-line
app.use(async (err, req, res, _) => {
  res.status(403);
  await render(res, "error", {
    pagename: "Error",
    error: err.message || err.toString()
  });
});

function setupWS(server) {
  const io = sio(server, {
    path: "/w",
    transports: ["websocket"],
    serveClient: false,
    pingInterval: 10000,
    pingTimeout: 10000,
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
    if (socket.room.config.get("inviteonly")) {
      const user = socket.handshake.cookies.session &&
        await User.load(socket.handshake.cookies.session);
      if (!user || user.role !== "mod") {
        const token = rtoken(socket.handshake);
        if (!socket.room.invited(user, token)) {
          next(new Error("You're not invited!"));
          return;
        }
      }
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
