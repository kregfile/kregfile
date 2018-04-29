"use strict";

const {token, toMessage, parseCommand, plural} = require("./util");
const BROKER = require("./broker");
const CONFIG = require("./config");
const nicknames = require("./nicknames");
const tracking = require("./tracking");
const clientversion = require("./clientversion");
const {registerUploadKey, queryOffset} = require("./upload");
const {User} = require("./user");
const bans = require("./bans");

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
    this.tracking = false;

    this.nick = null;
    this.onnick(nick);
    this.nick = this.nick || nicknames.random();

    this.onusercount = this.onusercount.bind(this);
    this.onconfig = this.onconfig.bind(this);
    this.onfiles = this.onfiles.bind(this);
    this.onsession = this.onsession.bind(this);
    this.onbreqpubkey = this.onbreqpubkey.bind(this);
    this.onbprivmsg = this.onbprivmsg.bind(this);
    this.onpacketcreate = this.onpacketcreate.bind(this);
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
    socket.on("trash", this.ontrash.bind(this));
    socket.on("ban", this.onban.bind(this));
    socket.on("unban", this.onunban.bind(this));
    socket.on("blacklist", this.onblacklist.bind(this));
    socket.on("whitelist", this.onwhitelist.bind(this));
    socket.conn.on("packetCreate", this.onpacketcreate);

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

  async hellbanned() {
    return this.role !== "mod" && !!await bans.findBan(
      "hellban", this.ip, this.user && this.user.account);
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

  onpacketcreate(p) {
    if (p.type !== "pong") {
      return;
    }
    if (this.user && this.session) {
      this.user.refreshSession(this.session).catch(console.warn);
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
      this.channels.add("log");
      if (this.tracking) {
        this.tracking = false;
        await this.room.untrackClient(this.ip);
      }
    }
    else {
      this.channels.delete("Admin");
      this.channels.delete("log");
      if (!this.tracking) {
        this.tracking = true;
        await this.room.trackClient(this.ip);
      }
    }
  }

  async ontrash(files) {
    try {
      this.ensurePrivilege();
      const num = await this.room.trash(files);
      this.broadcast({
        user: "Log",
        role: "system",
        channel: "log",
        volatile: true,
        msg: [
          { t: "p", v: this.nick, r: this.role },
          { t: "t", v: ` removed ${plural(num, "file", "files")}`},
        ]
      });
    }
    catch (ex) {
      console.error(ex);
      this.unicast({
        user: "Error",
        role: "system",
        volatile: true,
        msg: await toMessage(ex.message || ex.toString())
      });
    }
  }

  async onban(subjects, opts) {
    try {
      this.ensureMod();
      await this.room.ban(this.user, subjects, opts);
    }
    catch (ex) {
      console.error(ex);
      this.unicast({
        user: "Error",
        role: "system",
        volatile: true,
        msg: await toMessage(ex.message || ex.toString())
      });
    }
  }

  async onunban(subjects, opts) {
    try {
      this.ensureMod();
      await this.room.unban(this.user, subjects, opts);
    }
    catch (ex) {
      console.error(ex);
      this.unicast({
        user: "Error",
        role: "system",
        volatile: true,
        msg: await toMessage(ex.message || ex.toString())
      });
    }
  }

  async onblacklist(opts, files) {
    try {
      this.ensureMod();
      await this.room.blacklist(this.user, opts, files);
    }
    catch (ex) {
      console.error(ex);
      this.unicast({
        user: "Error",
        role: "system",
        volatile: true,
        msg: await toMessage(ex.message || ex.toString())
      });
    }
  }

  async onwhitelist(files) {
    try {
      this.ensureMod();
      await this.room.whitelist(this.user, files);
    }
    catch (ex) {
      console.error(ex);
      this.unicast({
        user: "Error",
        role: "system",
        volatile: true,
        msg: await toMessage(ex.message || ex.toString())
      });
    }
  }

  ensurePrivilege() {
    if (!this.privileged) {
      throw new Error("You cannot do that!");
    }
  }

  ensureMod() {
    if (this.role !== "mod") {
      throw new Error("You cannot do that!");
    }
  }

  emitConfig() {
    const c = Array.from(this.room.config);
    c.unshift(["name", CONFIG.get("name")]);
    this.emit("config", c);
  }

  async init() {
    this.room.ref();

    this.emit("time", Date.now());
    await this.onsession(this.session);
    this.emit("token", this.token);
    this.emitConfig();

    const files = await this.room.getFilesFor(this);
    this.emit("files", {replace: true, files});
  }

  broadcast(msg) {
    const admin = {
      ips: [this.ip],
      accounts: [],
    };
    if (this.user) {
      admin.accounts.push(this.user.account);
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
    const mod = this.role === "mod";
    if (m.hellbanned) {
      m = Object.assign({}, m);
      delete m.hellbanned;
      if (mod) {
        m.channel = "Hellbanned";
      }
      else if (m.ip !== this.ip) {
        return;
      }
    }
    if (!mod) {
      m = Object.assign({}, m);
      delete m.admin;
      delete m.ip;
    }
    this.emit("message", m);
  }

  async cmd_me(msg) {
    this.broadcast({
      msg: await toMessage(msg),
      me: true,
      hellbanned: await this.hellbanned(),
    });
    return true;
  }

  async cmd_a(msg) {
    if (this.role !== "mod") {
      return false;
    }
    this.broadcast({
      msg: await toMessage(msg),
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
    if (this.role !== "mod") {
      const mute = await bans.findBan(
        "mute", this.ip, this.user && this.user.account);
      if (mute) {
        this.unicast({
          volatile: true,
          user: "System",
          role: "system",
          msg: await toMessage(mute.toUserMessage("mute"))
        });
        return;
      }
    }

    if (!this.privileged && await this.chatFlooding.flooding()) {
      this.unicast({
        volatile: true,
        user: "System",
        role: "system",
        msg: await toMessage("You're posting too fast")
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
              msg: await toMessage(msg)
            });
          }
        }
        catch (ex) {
          console.error(ex);
          this.unicast({
            user: "Error",
            role: "system",
            volatile: true,
            msg: await toMessage(ex.message || ex.toString())
          });
        }
        return;
      }
      if (msg[0] === "/") {
        msg = msg.slice(1);
      }
      this.broadcast({
        msg: await toMessage(msg),
        hellbanned: await this.hellbanned(),
      });
    }
    catch (ex) {
      this.unicast({
        volatile: true,
        user: "System",
        role: "system",
        msg: await toMessage(ex.message || ex.toString())
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

    case "deleted":
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

    case "hidden": {
      let visible = this.room.convertFiles(files, this);
      if (visible.length) {
        this.emit("files", {files: visible});
      }
      visible = new Set(visible.map(e => e.key));
      const hidden = files.
        filter(f => !visible.has(f.key)).
        map(f => f.key);
      if (hidden.length) {
        this.emit("files-deleted", hidden);
      }
      return;
    }
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
    this.socket.conn.removeListener("packetCreate", this.onpacketcreate);

    this.room.removeListener("usercount", this.onusercount);
    this.room.removeListener("config", this.onconfig);
    this.room.removeListener("files", this.onfiles);
    this.room.unref();
    if (this.tracking) {
      this.room.untrackClient(this.ip).catch(console.error);
    }

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
      this.emit("uploadkey", {err: ex.message || ex.toString()});
    }
  }

  async onfileinfo(key) {
    try {
      const file = await this.room.getFileInfo(key, this);
      this.emit(`fileinfo-${key}`, file);
    }
    catch (ex) {
      this.emit(`fileinfo-${key}`, {err: ex.message || ex.toString()});
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
      this.emit(`profileinfo-${profile}`, {err: ex.message || ex.toString()});
    }
  }

  async onqueryoffset(key) {
    try {
      const offset = await queryOffset(key);
      this.emit(`queryoffset-${key}`, offset);
    }
    catch (ex) {
      this.emit(`queryoffset-${key}`, {err: ex.message || ex.toString()});
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
