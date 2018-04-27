"use strict";

const {token, toMessage, parseCommand} = require("./util");
const BROKER = require("./broker");
const CONFIG = require("./config");
const nicknames = require("./nicknames");
const tracking = require("./tracking");
const clientversion = require("./clientversion");
const {registerUploadKey, queryOffset} = require("./upload");
const {User} = require("./user");

class Channels extends Set {
  constructor(owner) {
    super();
    this.owner = owner;
    BROKER.on("message", owner.unicast);
    BROKER.on(`${owner.roomid}:message`, owner.unicast);
  }

  add(channel) {
    if (this.has(channel)) {
      return this;
    }
    super.add(channel);
    BROKER.on(`message:${channel}`, this.owner.unicast);
    BROKER.on(`${this.owner.roomid}:message:${channel}`, this.owner.unicast);
    return this;
  }

  delete(channel) {
    if (!super.delete(channel)) {
      return false;
    }
    BROKER.removeListener(`message:${channel}`, this.owner.unicast);
    BROKER.removeListener(`${this.owner.roomid}:message:${channel}`, this.owner.unicast);
    return true;
  }

  clear() {
    for (const c of Array.from(this)) {
      this.delete(c);
    }
    BROKER.removeListener("message", this.owner.unicast);
    BROKER.removeListener(`${this.owner.roomid}:message`, this.owner.unicast);
  }
}

class Client {
  constructor(room, socket, rtoken) {
    const {remoteAddress, remotePort} = socket.request.connection;
    this.socket = socket;
    this.ip = remoteAddress;
    this.room = room;
    this.roomid = this.room.roomid;
    this.port = remotePort;
    this.address = `${this.ip}:${this.port}`;
    this.role = "white";
    this.token = rtoken;

    const {nick, cv} = socket.handshake.query;
    const {cookies} = socket.handshake;
    this.session = cookies && cookies.session;
    this.user = null;

    this.nick = null;
    this.onnick(nick);
    this.nick = this.nick || nicknames.random();

    this.onusercount = this.onusercount.bind(this);
    this.onconfig = this.onconfig.bind(this);
    this.onfiles = this.onfiles.bind(this);
    this.onsession = this.onsession.bind(this);
    this.onbreqpubkey = this.onbreqpubkey.bind(this);
    this.onbprivmsg = this.onbprivmsg.bind(this);
    this.unicast = this.unicast.bind(this);
    this.emit = socket.emit.bind(socket);

    this.channels = new Channels(this);

    const {FloodProtector} = tracking;
    this.chatFlooding = new FloodProtector(
      this.ip,
      tracking.floods,
      CONFIG.get("chatFloodTrigger"),
      CONFIG.get("chatFloodDuration")
    );
    this.uploadFlooding = new FloodProtector(
      this.ip,
      tracking.uploadFloods,
      CONFIG.get("uploadFloodTrigger"),
      CONFIG.get("uploadFloodDuration")
    );

    Object.seal(this);

    socket.on("message", this.onmessage.bind(this));
    socket.on("nick", this.onnick.bind(this));
    socket.on("disconnect", this.onclose.bind(this));
    socket.on("uploadkey", this.onuploadkey.bind(this));
    socket.on("queryoffset", this.onqueryoffset.bind(this));
    socket.on("fileinfo", this.onfileinfo.bind(this));
    socket.on("profileinfo", this.onprofileinfo.bind(this));
    socket.on("reqpubkey", this.onsreqpubkey.bind(this));
    socket.on("privmsg", this.onsprivmsg.bind(this));
    socket.on("session", this.onsession);

    this.room.on("usercount", this.onusercount);
    this.room.on("config", this.onconfig);
    this.room.on("files", this.onfiles);

    tracking.clients.incr(this.ip);

    if (cv !== clientversion) {
      this.emit("outdated");
    }

    console.log(`Client at ${this.address.bold} connected`);
  }

  get owner() {
    return this.room.owns(this.user && this.user.account, this.token);
  }

  get privileged() {
    return this.role === "mod" || this.owner;
  }

  onsprivmsg(data) {
    const {user} = data;
    delete data.user;
    const admin = {
      ips: [this.ip],
    };
    if (this.user) {
      admin.accts = [this.user.account];
    }
    BROKER.emit(`${this.roomid}:privmsg:${user}`, Object.assign(data, {
      user: this.nick,
      role: this.role,
      admin,
      ip: this.ip,
    }));
  }

  onbprivmsg(m) {
    if (this.role !== "mod") {
      m = Object.assign({}, m);
      delete m.admin;
      delete m.ip;
    }
    this.emit("privmsg", m);
  }

  async onbreqpubkey() {
    if (!this.user) {
      return;
    }
    let pkey = null;
    try {
      pkey = await new Promise((resolve, reject) => {
        this.socket.once("pubkey", resolve);
        setTimeout(reject, 10000);
        this.emit("pubkey");
      });
    }
    catch (ex) {
      // ingored
    }
    if (!this.user) {
      return;
    }
    BROKER.emit(`pubkey:${this.user.account}`, pkey);
  }

  async onsreqpubkey(who) {
    let clean = null;
    try {
      let pkey = new Promise((resolve, reject) => {
        clean = resolve;
        BROKER.once(`pubkey:${who}`, resolve);
        setTimeout(reject, 10000);
        BROKER.emit(`reqpubkey:${who}`);
      });
      pkey = await pkey;
      this.emit(`reqpubkey-${who}`, pkey);
    }
    catch (ex) {
      BROKER.removeListener(`pubkey:${who}`, clean);
      this.emit(`reqpubkey-${who}`, null);
    }
  }

  async onsession(session) {
    this.session = session;
    if (this.user) {
      BROKER.removeListener(`reqpubkey:${this.user.account}`, this.onbreqpubkey);
      BROKER.removeListener(`${this.roomid}:privmsg:${this.user.account}`, this.onbprivmsg);
    }
    this.user = this.session ? await User.load(this.session) : null;
    if (this.user) {
      this.role = this.user.role;
      this.onnick(this.nick);
      this.emit("nick", this.user.name);
      this.emit("authed", this.user.account);
      BROKER.on(`reqpubkey:${this.user.account}`, this.onbreqpubkey);
      BROKER.on(`${this.roomid}:privmsg:${this.user.account}`, this.onbprivmsg);
    }
    else {
      this.role = "white";
      this.emit("authed", null);
    }
    this.emit("role", this.role);
    this.emit("nick", this.nick);
    this.emit("owner", this.owner);

    if (this.role === "mod") {
      this.channels.add("Admin");
      this.channels.add("Hellbanned");
    }
    else {
      this.channels.delete("Admin");
      this.channels.delete("Hellbanned");
    }
  }

  emitConfig() {
    const c = Array.from(this.room.config);
    c.unshift(["name", CONFIG.get("name")]);
    this.emit("config", c);
  }

  async init() {
    this.emit("time", Date.now());
    await this.onsession(this.session);
    this.emit("token", this.token);
    this.emitConfig();
    await this.room.ref(this.ip);
    const files = await this.room.getFilesFor(this);
    this.emit("files", {replace: true, files});
  }

  broadcast(msg) {
    const admin = {
      ips: [this.ip],
    };
    if (this.user) {
      admin.accts = [this.user.account];
    }
    let {channel = ""} = msg;
    if (channel) {
      channel = `:${channel}`;
    }
    BROKER.emit(`${this.roomid}:message${channel}`, Object.assign({
      user: this.nick,
      owner: this.owner,
      role: this.role,
      admin,
      ip: this.ip,
    }, msg));
  }

  unicast(m) {
    if (this.role !== "mod") {
      m = Object.assign({}, m);
      delete m.admin;
      delete m.ip;
    }
    this.emit("message", m);
  }

  cmd_me(msg) {
    this.broadcast({
      msg: toMessage(msg),
      me: true
    });
    return true;
  }

  cmd_a(msg) {
    if (this.role !== "mod") {
      return false;
    }
    this.broadcast({
      msg: toMessage(msg),
      channel: "Admin",
    });
    return true;
  }

  doCommand(cmd) {
    const fn = this[`cmd_${cmd.cmd}`];
    if (!fn) {
      return false;
    }
    return fn.call(this, cmd.args);
  }

  async onmessage(msg) {
    if (!this.privileged && await this.chatFlooding.flooding()) {
      this.unicast({
        volatile: true,
        user: "System",
        role: "system",
        msg: toMessage("You're posting too fast")
      });
      return;
    }
    msg = msg.trim();
    try {
      const cmd = parseCommand(msg);
      if (cmd) {
        try {
          let local = this.doCommand(cmd);
          if (local && local.then) {
            local = await local;
          }
          if (local) {
            return;
          }

          let msg = this.room.doCommand(this, cmd);
          if (msg && msg.then) {
            msg = await msg;
          }
          if (msg) {
            this.unicast({
              user: "Command",
              role: "system",
              volatile: true,
              msg: toMessage(msg)
            });
          }
        }
        catch (ex) {
          console.error(ex);
          this.unicast({
            user: "Error",
            role: "system",
            volatile: true,
            msg: toMessage(ex.message || ex.toString())
          });
        }
        return;
      }
      if (msg[0] === "/") {
        msg = msg.slice(1);
      }
      this.broadcast({
        msg: toMessage(msg),
      });
    }
    catch (ex) {
      this.unicast({
        volatile: true,
        user: "System",
        role: "system",
        msg: toMessage(ex.message || ex.toString())
      });
    }
  }

  onusercount(count) {
    this.emit("usercount", count);
  }

  onconfig(key, value) {
    if (key === "owners") {
      this.emit("owner", this.owner);
    }
    this.emit("config", [[key, value]]);
  }

  onfiles(action, files) {
    switch (action) {
    case "add":
      files = this.room.convertFiles(files, this);
      if (!files.length) {
        return;
      }
      this.emit("files", {files});
      return;

    case "delete":
      if (!files.length) {
        return;
      }
      files = files.map(f => f.key);
      this.emit("files-deleted", files);
      return;

    case "updated":
      files = this.room.convertFiles(files, this);
      this.emit("files-updated", files);
      return;
    }
  }

  onnick(nick) {
    if (!nick) {
      return;
    }
    nick = nicknames.sanitize(nick, this.user);
    if (!nick) {
      return;
    }
    this.nick = nick;
    if (this.user && this.user.lastName !== nick) {
      this.user.lastName = nick;
      this.user.save();
    }
  }

  onclose() {
    tracking.clients.decr(this.ip);
    this.channels.clear();
    if (this.user) {
      BROKER.removeListener(`reqpubkey:${this.user.account}`, this.onbreqpubkey);
      BROKER.removeListener(`${this.roomid}:privmsg:${this.user.account}`, this.onbprivmsg);
    }

    this.socket.removeAllListeners();

    this.room.removeListener("usercount", this.onusercount);
    this.room.removeListener("config", this.onconfig);
    this.room.removeListener("files", this.onfiles);
    this.room.unref(this.ip);
    console.log(`Client at ${this.address.bold} disconnected`);
  }

  async onuploadkey() {
    try {
      if (!this.privileged) {
        const floodEnd = await this.uploadFlooding.flooding();
        if (floodEnd) {
          this.emit("uploadkey", {wait: floodEnd});
          return;
        }
      }
      const key = await token();
      await registerUploadKey(this.roomid, this.nick, key);
      this.emit("uploadkey", key);
    }
    catch (ex) {
      this.emit("uploadkey", {err: ex.message || ex.toMessage()});
    }
  }

  async onfileinfo(key) {
    try {
      const file = await this.room.getFileInfo(key, this);
      this.emit(`fileinfo-${key}`, file);
    }
    catch (ex) {
      this.emit(`fileinfo-${key}`, {err: ex.message || ex.toMessage()});
    }
  }

  async onprofileinfo(profile) {
    try {
      const info = await User.getInfo(profile);
      if (!info) {
        throw new Error("Unknown user");
      }
      this.emit(`profileinfo-${profile}`, info);
    }
    catch (ex) {
      this.emit(`profileinfo-${profile}`, {err: ex.message || ex.toMessage()});
    }
  }

  async onqueryoffset(key) {
    try {
      const offset = await queryOffset(key);
      this.emit(`queryoffset-${key}`, offset);
    }
    catch (ex) {
      this.emit(`queryoffset-${key}`, {err: ex.message || ex.toMessage()});
    }
  }

  static async create(socket, token) {
    console.debug(`New client in ${socket.room}`);
    const client = new Client(socket.room, socket, token);
    await client.init();
    return client;
  }
}

module.exports = {Client};
