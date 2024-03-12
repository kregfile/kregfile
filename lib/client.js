"use strict";

const msgpack = require("notepack.io");
const {
  CoalescedUpdate,
  parseCommand,
  plural,
  toMessage,
  token,
} = require("./util");
const BROKER = require("./broker");
const CONFIG = require("./config");
const nicknames = require("./nicknames");
const {FloodProtector, clients: trackClients} = require("./tracking");
const clientversion = require("./clientversion");
const verifier = require("./sessionverifier");
const {registerUploadKey, queryOffset} = require("./upload");
const {User} = require("./user");
const bans = require("./bans");
const {v4: uuidv4} = require("uuid");

const redis = BROKER.getMethods("set", "removemessages");

const DYING = new CoalescedUpdate(20000, clients => clients.forEach(async c => {
  if (await !c.checkAlive()) {
    return;
  }
  DYING.add(c);
}));

const RECLIENTS = new Map();
BROKER.on("reqresumptions", stoken => {
  const c = RECLIENTS.get(stoken);
  if (!c) {
    return;
  }
  BROKER.emit(`resumptions:${stoken}`, msgpack.encode(c.resumptions).toString("binary"));
});

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
    if (CONFIG.get("considerProxyForwardedForHeaders")) {
      this.ip = socket.request.headers["x-forwarded-for"] || remoteAddress;
      [this.ip] = this.ip.split(",");
    }
    else {
      this.ip = remoteAddress;
    }
    this.room = room;
    this.roomid = this.room.roomid;
    this.port = remotePort;
    this.address = `${this.ip}:${this.port}`;
    this.role = "white";
    this.token = rtoken;
    this.stoken = rtoken + Date.now();
    this.lastUserCount = 0;
    this.seq = 0;

    this.session = null;
    const {nick, cv, s, n} = socket.handshake.query;
    const {cookies = {}} = socket.handshake;
    const {session} = cookies;

    /*
      Verify the connection attempt if it has a session associated to it.

      The verification relies on hmax of the session id itself.
      If the session is known to the attacker, the verifier might be guessed,
      but at this point it would be game over anyway.
    */
    if (session && verifier.verify(CONFIG.get("secret"), session, s, n)) {
      this.session = session;
    }
    this.user = null;
    this.tracking = false;
    this.disabled = this.room.config.get("disabled") || false;
    this.died = 0;
    this.resumptions = [];
    RECLIENTS.set(this.stoken, this);

    this.nick = null;
    this.onnick(nick);
    this.nick = this.nick || nicknames.random();

    this.onusercount = this.onusercount.bind(this);
    this.onconfig = this.onconfig.bind(this);
    this.onfiles = this.onfiles.bind(this);
    this.onsession = this.onsession.bind(this);
    this.onbreqpubkey = this.onbreqpubkey.bind(this);
    this.onbprivmsg = this.onbprivmsg.bind(this);
    this.onheartbeat = this.onheartbeat.bind(this);
    this.oncontinue = this.oncontinue.bind(this);
    this.unicast = this.unicast.bind(this);

    this.channels = new Channels(this);

    this.chatFlooding = new FloodProtector(
      this.ip,
      "chatfloods",
      CONFIG.get("chatFloodTrigger"),
      CONFIG.get("chatFloodDuration")
    );
    this.reportFlooding = new FloodProtector(
      this.ip,
      "reportfloods",
      CONFIG.get("reportFloodTrigger"),
      CONFIG.get("reportFloodDuration")
    );
    this.uploadFlooding = new FloodProtector(
      this.ip,
      "uploadFloods",
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
    socket.on("NUKE!!!!", this.onnuke.bind(this));
    socket.on("removeMessage", this.onremovemessage.bind(this));
    socket.on("blacklist", this.onblacklist.bind(this));
    socket.on("whitelist", this.onwhitelist.bind(this));
    socket.on("setconfig", this.onsetconfig.bind(this));
    socket.on("continue", this.oncontinue.bind(this));
    socket.on("report", this.onreport.bind(this));
    socket.conn.on("heartbeat", this.onheartbeat);

    this.room.on("usercount", this.onusercount);
    this.room.on("config", this.onconfig);
    this.room.on("files", this.onfiles);
    this.room.on("removeMessages", this.onremovemessages.bind(this));

    trackClients.incr(this.ip);

    if (cv !== clientversion) {
      this.emitOnce("outdated");
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

  get invited() {
    if (this.role === "mod") {
      return true;
    }
    return this.room.invited(this.user, this.token);
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

  onheartbeat() {
    if (this.user && this.session) {
      this.user.refreshSession(this.session);
    }
    this.resumptions.length = 0;
  }

  async oncontinue(stoken, seq) {
    try {
      const client = RECLIENTS.get(stoken);
      let resumptions = client && client.resumptions;
      if (!resumptions) {
        // out of process?
        resumptions = await new Promise(resolve => {
          BROKER.once(`resumptions:${stoken}`, d => {
            try {
              resolve(msgpack.decode(Buffer.from(d, "binary")));
            }
            catch (ex) {
              console.error("error", ex);
              resolve(null);
            }
          });
          setTimeout(() => {
            BROKER.removeListener(`resumptions:${stoken}`, resolve);
            resolve(null);
          }, 1000);
          BROKER.emit("reqresumptions", stoken);
        });
      }
      if (!resumptions) {
        this.emitOnce(`continue-${stoken}`, false);
        return;
      }
      resumptions.
        filter(e => e.seq > seq).
        forEach(e => this.emit(e.ev, ...e.args));
    }
    catch (ex) {
      console.error("failed to re-emit queued", ex);
    }
    this.emitOnce(`continue-${stoken}`, true);
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
    this.emit("usercount", this.room.usercount);

    if (this.role === "mod") {
      this.channels.add("Admin");
      this.channels.add("reports");
      this.channels.add("log");
      if (this.tracking) {
        this.tracking = false;
        await this.room.untrackClient(this.ip);
      }
    }
    else {
      this.channels.delete("Admin");
      this.channels.delete("reports");
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
      await this.broadcast({
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

  async onremovemessage(id, options) {
    try {
      this.ensureMod();
      if (!options.user && !options.ip) {
        BROKER.emit(`removeMessages:${this.roomid}`, [id]);
      }
      else {
        await redis.removemessages(
          id, options.user, options.ip, options.room);
      }
      this.socket.emit(`removeMessage-${id}`);
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

  onremovemessages(ids) {
    this.emit("removeMessages", ids);
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

  async onnuke() {
    try {
      this.ensureMod();
      await this.room.nuke(this.user);
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

  async setConfig(name, arg) {
    this.ensurePrivilege();
    switch (name) {
    case "name":
      if (arg.length < 3 || arg.length > 20) {
        throw new Error("Invalid room name");
      }
      this.room.config.set("roomname", arg);
      return;

    case "motd":
      await this.room.setMOTD(arg);
      return;

    case "adult":
      this.room.config.set("adult", !!arg);
      return;

    case "disabled":
      this.ensureMod();
      this.room.config.set("disabled", !!arg);
      return;

    case "disableReports":
      this.ensureMod();
      this.room.config.set("disableReports", !!arg);
      return;

    case "owners":
      await this.room.setOwners(arg);
      return;

    case "inviteonly":
      await this.room.setInviteOnly(arg);
      return;

    case "invitees":
      await this.room.setInvitees(arg);
      return;

    case "fileTTL":
      this.ensureMod();
      this.room.fileTTL = arg;
      return;

    default:
      throw new Error(`Invalid config name '${name}'`);
    }
  }

  async onsetconfig(name, arg) {
    try {
      await this.setConfig(name, arg);
      this.socket.emit(`setconfig-${name}`);
    }
    catch (ex) {
      this.socket.emit(`setconfig-${name}`, {
        err: ex.message || ex.toString()
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

  checkAlive() {
    if (this.died + 120 * 1000 > Date.now()) {
      return true;
    }
    this.onreallyclose();
    return false;
  }

  emitOnce(ev, ...args) {
    if (!this.socket) {
      return;
    }
    this.socket.emit(ev, ...args);
  }

  emit(ev, ...args) {
    if (!this.socket) {
      this.resumptions.push({
        seq: this.seq++,
        ev,
        args
      });
      return;
    }
    this.resumptions.push({
      seq: this.socket.server.encoder.seq,
      ev,
      args
    });
    this.socket.emit(ev, ...args);
  }

  emitConfig() {
    this.emitOnce("config", this.room.exportedRoomConfig);
  }

  async init() {
    this.room.ref();

    this.emitConfig();
    this.emit("time", Date.now());
    await this.onsession(this.session);
    this.emitOnce("token", this.token);
    this.emit("stoken", this.stoken);

    const files = await this.room.getFilesFor(this);
    this.emitOnce("files", {replace: true, files});
  }

  async broadcast(msg) {
    if (this.disabled && this.role !== "mod") {
      this.unicast({
        volatile: true,
        user: "Error",
        role: "system",
        msg: "This room was disabled by a moderator!"});
      return;
    }

    // Register a message id
    let id;
    const messageInfo = {
      a: this.user ? this.user.account : `s:${this.session}`,
      i: this.ip,
      r: this.roomid,
    };
    for (;;) {
      id = uuidv4();
      const mkey = `message:${id}`;
      const ok = await redis.set(
        mkey, JSON.stringify(messageInfo), "EX", 2 * 60 * 60, "NX");
      if (!ok) {
        continue;
      }
      await Promise.all([
        redis.set(`massoc:a:${messageInfo.a}:${this.roomid}:${id}`, 1, "EX", 2 * 60 * 60),
        redis.set(`massoc:i:${messageInfo.i}:${this.roomid}:${id}`, 1, "EX", 2 * 60 * 60),
      ]);
      break;
    }

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
      id,
      user: this.nick,
      owner: this.owner,
      role: this.role,
      admin,
      ip: this.ip,
    }, msg));
  }

  unicast(m) {
    const mod = this.role === "mod";
    m = Object.assign({
      sdate: Date.now()
    }, m);
    if (m.hellbanned) {
      if (mod) {
        m.channel = "Hellbanned";
      }
      else if (m.ip !== this.ip) {
        return;
      }
    }
    delete m.hellbanned;
    if (!mod) {
      delete m.admin;
      delete m.ip;
    }
    this.emit("message", m);
  }

  async changeUser(arg, m) {
    this.ensurePrivilege();
    arg = arg.trim();
    const account = arg.toLowerCase();
    if (!await User.exists(account)) {
      throw new Error("Invalid account");
    }
    this.room[m](account);
  }

  async onreport(msg) {
    const admin = {
      ips: [this.ip],
      accounts: [],
    };
    if (this.user) {
      admin.accounts.push(this.user.account);
    }

    if (this.room.config.get("disableReports")) {
      this.unicast({
        volatile: true,
        user: "System",
        role: "system",
        msg: await toMessage("Reports are disabled in this room")
      });
      return;
    }

    if (!this.privileged && await this.reportFlooding.bump()) {
      this.unicast({
        volatile: true,
        user: "System",
        role: "system",
        msg: await toMessage("You're reporting too fast")
      });
      return;
    }

    BROKER.emit("message:reports", {
      notify: false,
      user: "Report",
      role: "system",
      msg: await toMessage(`${this.nick} / #${this.roomid} / ${msg}`),
      admin,
      ip: this.ip
    });
  }

  async cmd_setmotd(arg) {
    await this.setConfig("motd", arg);
  }

  async cmd_name(arg) {
    await this.setConfig("name", arg);
    return `Changed room name to: ${arg}`;
  }

  async cmd_addowner(arg) {
    await this.changeUser(arg, "addOwner");
    return `${arg} added as an owner`;
  }

  async cmd_invitee(arg) {
    await this.changeUser(arg, "addInvitee");
    return `${arg} added as an invited user`;
  }

  async cmd_removeowner(arg) {
    await this.changeUser(arg, "removeOwner");
    return `${arg} removed as an owner`;
  }

  async cmd_removeinvitee(arg) {
    await this.changeUser(arg, "removeInvitee");
    return `${arg} removed as an invited user`;
  }

  async cmd_me(msg) {
    await this.broadcast({
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
    await this.broadcast({
      msg: await toMessage(msg),
      channel: "Admin",
    });
    return true;
  }

  doCommand(cmd) {
    const fn = this[`cmd_${cmd.cmd}`];
    if (!fn) {
      throw new Error("Not a valid command!");
    }
    return fn.call(this, cmd.args);
  }

  async onmessage(msg) {
    if (CONFIG.get("requireAccounts") && this.role === "white") {
      this.unicast({
        volatile: true,
        user: "System",
        role: "system",
        msg: "You need to log in to chat"
      });
      return;
    }

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

    if (!this.privileged && await this.chatFlooding.bump()) {
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
          let msg = this.doCommand(cmd);
          if (msg && msg.then) {
            msg = await msg;
          }
          if (msg === true) {
            return;
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
      await this.broadcast({
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
    if (this.lastUserCount === count) {
      return;
    }
    this.lastUserCount = count;
    this.emitOnce("usercount", count);
  }

  onconfig(key, value) {
    if (key === "owners") {
      this.emit("owner", this.owner);
    }
    if (key === "inviteonly" || key === "invitees" || key === "owners") {
      if (!this.invited) {
        // Let's fake an outdated message and force a reload!
        this.emit("outdated");
        // Close anyway!
        this.socket.on("drain", () => {
          this.socket.disconnect();
        });
      }
    }
    if (key === "disabled") {
      this.disabled = value;
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
      this.emitOnce("files", {files});
      return;

    case "deleted":
      if (!files.length) {
        return;
      }
      files = files.map(f => f.key);
      this.emitOnce("files-deleted", files);
      return;

    case "updated":
      files = this.room.convertFiles(files, this);
      this.emitOnce("files-updated", files);
      return;

    case "hidden": {
      let visible = this.room.convertFiles(files, this);
      if (visible.length) {
        this.emitOnce("files", {files: visible});
      }
      visible = new Set(visible.map(e => e.key));
      const hidden = files.
        filter(f => !visible.has(f.key)).
        map(f => f.key);
      if (hidden.length) {
        this.emitOnce("files-deleted", hidden);
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
    trackClients.decr(this.ip);
    if (this.user) {
      BROKER.removeListener(`reqpubkey:${this.user.account}`, this.onbreqpubkey);
      BROKER.removeListener(`${this.roomid}:privmsg:${this.user.account}`, this.onbprivmsg);
    }

    this.socket.removeAllListeners();
    this.socket.conn.removeListener("heartbeat", this.onheartbeat);

    if (this.tracking) {
      this.tracking = false;
      this.room.untrackClient(this.ip).catch(console.error);
    }

    this.died = Date.now();
    this.seq = this.socket.server.encoder.seq;
    this.socket = null;
    DYING.add(this);

    console.log(`Client at ${this.address.bold} disconnected`);
  }

  onreallyclose() {
    this.resumptions.length = 0;
    RECLIENTS.delete(this.stoken);
    this.channels.clear();
    this.room.removeListener("usercount", this.onusercount);
    this.room.removeListener("config", this.onconfig);
    this.room.removeListener("files", this.onfiles);
    this.room.unref();
    console.log(`Client at ${this.address.bold} died`);
  }

  async onuploadkey(id) {
    try {
      if (this.role !== "mod") {
        if (this.disabled) {
          throw new Error("This room was disabled by a moderator!");
        }
        const ban = await bans.findBan(
          "upload", this.ip, this.user && this.user.account);
        if (ban) {
          throw new Error(ban.toUserMessage("upload"));
        }
        if (this.role === "white" && CONFIG.get("requireAccounts")) {
          throw new Error("Uploading requires you register an account first");
        }
      }

      if (!this.privileged) {
        const now = Date.now();
        const floodEnd = await this.uploadFlooding.bump();
        if (floodEnd) {
          this.emit(`uploadkey-${id}`, {wait: now + floodEnd});
          return;
        }
      }
      const key = await token(20);
      await registerUploadKey(
        this.roomid, this.nick, key, this.room.fileTTL);
      this.emit(`uploadkey-${id}`, key);
    }
    catch (ex) {
      this.emit(`uploadkey-${id}`, {err: ex.message || ex.toString()});
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
