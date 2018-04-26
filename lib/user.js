"use strict";

const lru = require("lru-cache");
const crypto = require("crypto");
const request = require("request-promise-native");
const nicknames = require("./nicknames");
const BROKER = require("./broker");
const {FloodProtector, acctFloods} = require("./tracking");
const {ofilter, token} = require("./util");
const CONFIG = require("./config");
const passlib = require("passlib");

const redis = BROKER.getMethods(
  "get", "set", "del", "exists",
  "zscore", "zrevrank", "zincrby"
);

const TTL = CONFIG.get("sessionTTL");
const FAKE = passlib.create("fake");

const KEY = Symbol();

const ADOPT_OFILTER = Object.freeze(new Set([
  "email",
  "pubmail",
  "message",
]));

const UPSTAT_FILES = "uploadstat:files";
const UPSTAT_BYTES = "uploadstat:bytes";
const UPSTAT_EXPIRE = "uploadstat:expire";

const UPSTAT_CACHE = lru({
  max: 1000,
});

BROKER.on(UPSTAT_EXPIRE, acct => {
  UPSTAT_CACHE.del(acct);
});


class User {
  constructor(data) {
    Object.assign(this, data);
    if (!this.account) {
      throw new Error("No Account");
    }
    if (!this.role) {
      this.role = "user";
    }
    this[KEY] = `user:${this.account.toLowerCase()}`;
  }

  get name() {
    return this.lastName || this.account;
  }

  async uploadStats() {
    const c = UPSTAT_CACHE.get(this.account);
    if (c) {
      return c;
    }
    const rv = {
      uploaded: 0,
      uploadedRank: 0,
      files: 0,
      filesRank: 0,
    };
    try {
      const fu = await redis.zscore(UPSTAT_FILES, this.account);
      if (!fu) {
        return rv;
      }
      rv.files = parseInt(fu, 10) || 0;
      rv.filesRank = await redis.zrevrank(UPSTAT_FILES, this.account) + 1;
      rv.uploaded = parseInt(
        await redis.zscore(UPSTAT_BYTES, this.account), 10) || 0;
      rv.uploadedRank = await redis.zrevrank(UPSTAT_BYTES, this.account) + 1;
      return rv;
    }
    finally {
      UPSTAT_CACHE.set(this.account, rv);
    }
  }

  ensure() {
    if (!this[KEY]) {
      throw new Error("invalid user");
    }
  }

  async adopt(o) {
    Object.assign(this, ofilter(o, ADOPT_OFILTER));
    if (this.email.length > 200) {
      throw new Error("User email too long");
    }
    if (this.message.length > 2000) {
      throw new Error("User message too long");
    }
    if (this.email) {
      const h = crypto.createHash("md5").
        update(this.email.toLowerCase()).
        digest("hex");
      try {
        const res = await request.get(`https://gravatar.com/${h}.json`, {
          headers: {
            "User-Agent": "kregfile/1.0 like irc",
          },
          json: true,
        });
        const {entry: [info]} = res;
        this.gravtarProfile = info.profileUrl;
        this.gravatar = `https://gravatar.com/avatar/${h}?r=pg&size=200`;
      }
      catch (ex) {
        delete this.gravatarProfile;
        delete this.gravatar;
        console.error("Failed to git gravatar", ex.message);
      }
    }
  }

  async save() {
    this.ensure();
    await redis.set(this[KEY], JSON.stringify(this));
  }

  async makeSession() {
    this.ensure();
    const session = await token();
    await redis.set(`session:${session}`, this[KEY], "EX", TTL);
    return session;
  }

  async getInfo() {
    const rv = {
      name: this.name,
      role: this.role,
      uploadStats: await this.uploadStats(),
    };
    if (this.pubmail) {
      rv.email = this.email;
    }
    if (this.gravatar) {
      rv.gravatar = this.gravatar;
    }
    return rv;
  }

  async addUpload(bytes) {
    await redis.zincrby(UPSTAT_FILES, 1, this.account);
    await redis.zincrby(UPSTAT_BYTES, bytes | 0, this.account);
    UPSTAT_CACHE.del(this.account);
    BROKER.emit(UPSTAT_EXPIRE, this.account);
  }

  static async load(session) {
    const acct = await redis.get(`session:${session}`);
    if (!acct) {
      return null;
    }
    const data = await redis.get(acct);
    if (!data) {
      return null;
    }
    return new User(JSON.parse(data));
  }

  static async exists(account) {
    return !!(await redis.exists(`user:pw:${account}`));
  }

  static async get(acct) {
    const data = await redis.get(`user:${acct.toLowerCase()}`);
    if (!data) {
      return null;
    }
    return new User(JSON.parse(data));
  }

  static async getInfo(acct) {
    const user = await User.get(acct);
    if (!user) {
      return null;
    }
    return await user.getInfo();
  }

  static async login(ip, nick, pass) {
    const fp = new FloodProtector(
      `login:${ip}`,
      acctFloods,
      CONFIG.get("loginFloodTrigger"),
      CONFIG.get("loginFloodDuration")
    );
    if (await fp.flooding()) {
      throw new Error("Too many attempts in too little time!");
    }
    nick = nick.toLowerCase();
    const verify = await redis.get(`user:pw:${nick}`);
    const fake = await FAKE;
    const ok = await passlib.verify(verify || fake, pass);
    if (!verify || !ok) {
      throw new Error("Invalid username or password");
    }
    if (passlib.needsUpgrade(verify)) {
      pass = await passlib.create(pass);
      await redis.set(`user:pw:${nick}`, pass);
    }
    const data = await redis.get(`user:${nick}`);
    if (!data) {
      throw new Error("Invalid account data!");
    }
    const user = new User(JSON.parse(data));
    const session = await user.makeSession();
    await fp.delete();
    return {
      session,
      user: user.account,
      role: user.role,
    };
  }

  static async logout(session) {
    await redis.del(`session:${session}`);
  }

  static async create(ip, onick, pass) {
    const fp = new FloodProtector(
      `create:${ip}`,
      acctFloods,
      CONFIG.get("accountFloodTrigger"),
      CONFIG.get("accountFloodDuration")
    );
    if (fp.isFlooding) {
      throw new Error("Too many attempts in too little time");
    }
    const nick = nicknames.sanitize(onick);
    if (!nick || onick !== nick) {
      throw new Error("Invalid user name!");
    }
    if (nicknames.isDefault(nick)) {
      throw new Error("Cannot register a default name!");
    }
    const account = nick.toLowerCase();

    if (pass.length < 8 || !/\w/.test(pass) || !/\d/.test(pass)) {
      throw new Error("Invalid Password!");
    }
    const phrase = await passlib.create(pass);

    if ((await redis.set(`user:pw:${account}`, phrase, "NX")) !== "OK") {
      throw new Error("Account already taken!");
    }
    await fp.flooding();

    const opts = {
      account,
      lastName: nick,
      role: "user",
      created: Date.now(),
      changed: Date.now(),
    };
    const user = new User(opts);
    await user.save();
    return {
      session: await user.makeSession(),
      account: user.account
    };
  }
}

module.exports = { User };
