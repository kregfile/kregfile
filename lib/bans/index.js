"use strict";

const fs = require("fs");
const CONFIG = require("../config");
const BROKER = require("../broker");
const {patch} = require("../loglevel");
const {sort, toPrettyDuration} = require("../util");
const {DistributedMap} = require("../broker/collections");
const {BanRecord} = require("./banrecord");
const {UnbanRecord} = require("./unbanrecord");
const {WhitelistRecord} = require("./whitelistrecord");
const {NukeRecord} = require("./nukerecord");
const {ActiveBan} = require("./activeban");

const MODLOG = "modlog:";
const EXPIRE = 7 * 24 * 60 * 60;
const MODLOGFILE = fs.createWriteStream(CONFIG.get("modlog") || "mod.log", {
  flags: "a"
});
const LOG = patch(new console.Console(MODLOGFILE), {
  colors: false,
  name: "MODLOG",
});

const redis = BROKER.getMethods(
  "get", "set", "mget", "keys",
);

const ACTIVEACCT = new DistributedMap(
  "activebans:account", d => ActiveBan.fromData(d));
const ACTIVEIP = new DistributedMap(
  "activebans:ip", d => ActiveBan.fromData(d));

function toKey(record) {
  return MODLOG + record.id;
}

function _emitRecord(record, sub, global) {
  if (!record.files || !record.files.length || sub) {
    let topic = "message:log";
    if (!global && record.roomid) {
      topic = `${record.roomid}:message:log`;
    }
    const msg = record.toLogMessage();
    if (global && record.roomid) {
      msg.splice(1, 0,
        {t: "t", v: " in "},
        {t: "r", v: record.roomid},
        {t: "t", v: " "}
      );
    }
    msg.push(
      {t: "t", v: " / "},
      {t: "u", v: `/modlog/${record.id}`, n: "Details"}
    );
    const opts = {
      user: "Log",
      role: "system",
      channel: "log",
      volatile: true,
      msg
    };
    if (record.ips) {
      opts.admin = {
        accounts: record.accounts,
        ips: record.ips
      };
    }
    BROKER.emit(topic, opts);
    return;
  }

  let {ips, accounts} = record;
  if (ips) {
    ips = new Set(ips);
    accounts = new Set(accounts);
  }

  let subrecords = new Map();
  for (const f of record.files) {
    let r = subrecords.get(f.roomid);
    if (!r) {
      r = record.clone();
      r.roomid = f.roomid;
      if (r.ips) {
        r.ips.length = 0;
        r.accounts.length = 0;
      }
      if (r.files) {
        r.files.length = 0;
      }
      subrecords.set(f.roomid, r);
    }
    if (r.ips) {
      r.ips.push(f.ip);
      if (f.meta && f.meta.account) {
        r.accounts.push(f.meta.account);
      }
    }
    if (r.files) {
      r.files.push(f);
    }
  }
  subrecords = Array.from(subrecords.values());
  subrecords.forEach(r => {
    if (r.ips) {
      r.ips = Array.from(new Set(r.ips)).filter(i => ips.has(i));
      r.accounts = Array.from(new Set(r.accounts)).filter(a => accounts.has(a));
    }
    if (r.files) {
      r.files = Array.from(new Set(r.files));
    }
    _emitRecord(r, true, false);
  });

  // Emit bl records in full, globally
  if (record.mod.name === "BLACKLIST") {
    const blr = record.clone();
    _emitRecord(blr, true, true);
  }
}

function messageToText(msg) {
  const rv = [];
  for (const p of msg) {
    switch (p.t) {
    case "b":
      rv.push(": ");
      break;

    case "u": {
      if (p.v !== p.n && p.n) {
        rv.pish(`${p.n} <${p.v}>`);
      }
      break;
    }

    case "r": {
      rv.push(p.n || p.v);
      break;
    }

    default:
      rv.push(p.v);
      break;
    }
  }
  return rv.join("");
}

function _logBaseRecord(record, detailRecord) {
  const msg = messageToText(record.toLogMessage());
  const parts = [
    record.id, `[${record.roomid}]`, msg,
  ];
  LOG.warn(...parts);

  let {ips, accounts} = record;
  if (ips) {
    ips = new Set(ips);
    accounts = new Set(accounts);
    if (!detailRecord) {
      if (accounts.size) {
        LOG.info(record.id, "[accounts:", `${Array.from(accounts || []).join(", ")}]`);
        parts.push("[accounts:", `${Array.from(accounts || []).join(", ")}]`);
      }
      LOG.info(record.id, "[ips:", `${Array.from(ips || []).join(", ")}]`);
      parts.push("[ips:", `${Array.from(ips || []).join(", ")}]`);
    }
  }

  if (detailRecord) {
    if (!record.files) {
      return;
    }
    for (const file of record.files) {
      const fileparts = [];
      fileparts.push("[file:");
      fileparts.push(file.name);
      fileparts.push(file.key);
      fileparts.push(`(${file.hash})`);
      fileparts.push("size:", file.size);
      fileparts.push("uploaded:", new Date(file.uploaded).toUTCString());
      fileparts.push("ip:", file.ip);
      if (file.meta && file.meta.account) {
        fileparts.push("account:", file.meta.account);
      }
      fileparts.push("]");
      LOG.info(record.id, ...fileparts);
      parts.push(...fileparts);
    }
  }

  console.warn(...parts);

  if (detailRecord || !record.files) {
    return;
  }

  let subrecords = new Map();
  for (const f of record.files) {
    let r = subrecords.get(f.roomid);
    if (!r) {
      r = record.clone();
      r.roomid = f.roomid;
      if (r.ips) {
        r.ips.length = 0;
        r.accounts.length = 0;
      }
      if (r.files) {
        r.files.length = 0;
      }
      subrecords.set(f.roomid, r);
    }
    if (r.ips) {
      r.ips.push(f.ip);
      if (f.meta && f.meta.account) {
        r.accounts.push(f.meta.account);
      }
    }
    if (r.files) {
      r.files.push(f);
    }
  }
  subrecords = Array.from(subrecords.values());
  subrecords.forEach(r => {
    if (r.ips) {
      r.ips = Array.from(new Set(r.ips)).filter(i => ips.has(i));
      r.accounts = Array.from(new Set(r.accounts)).filter(a => accounts.has(a));
    }
    if (r.files) {
      r.files = Array.from(new Set(r.files));
    }
    _logBaseRecord(r, true);
  });
}

async function emitRecord(record) {
  await redis.set(toKey(record), JSON.stringify(record), "EX", EXPIRE);
  _logBaseRecord(record);
  _emitRecord(record, false, false);
}

async function ban(roomid, mod, subjects, options, files) {
  const record = BanRecord.create(roomid, mod, subjects, options, files);
  for (const b of Array.from(record.toBans())) {
    let active;
    switch (b.type) {
    case "account":
      await ACTIVEACCT.loaded;
      active = ACTIVEACCT.get(b.subject);
      break;

    case "ip":
      await ACTIVEIP.loaded;
      active = ACTIVEIP.get(b.subject);
      break;
    }
    if (active) {
      if (!active.merge(b)) {
        record.nuke(b);
        continue;
      }
    }
    else {
      active = ActiveBan.create(b);
    }
    switch (b.type) {
    case "account":
      ACTIVEACCT.set(b.subject, active);
      break;

    case "ip":
      ACTIVEIP.set(b.subject, active);
      break;
    }
  }
  await emitRecord(record);
  return record;
}

async function unban(roomid, mod, subjects, options) {
  const record = UnbanRecord.create(roomid, mod, subjects, options);
  let unbanned = false;
  for (const b of record.toUnbans()) {
    let active;
    switch (b.type) {
    case "account":
      await ACTIVEACCT.loaded;
      active = ACTIVEACCT.get(b.subject);
      break;

    case "ip":
      await ACTIVEIP.loaded;
      active = ACTIVEIP.get(b.subject);
      break;
    }
    if (!active) {
      continue;
    }
    if (!active.remove(b)) {
      continue;
    }
    unbanned = true;

    switch (b.type) {
    case "account":
      if (active.any) {
        ACTIVEACCT.set(b.subject, active);
      }
      else {
        ACTIVEACCT.delete(b.subject, active);
      }
      break;

    case "ip":
      if (active.any) {
        ACTIVEIP.set(b.subject, active);
      }
      else {
        ACTIVEIP.delete(b.subject);
      }
      break;
    }
  }
  if (!unbanned) {
    return null;
  }
  await emitRecord(record);
  return record;
}

async function whitelist(roomid, mod, files) {
  const record = WhitelistRecord.create(roomid, mod, files);
  await emitRecord(record);
  return record;
}

async function nuke(roomid, mod) {
  const record = NukeRecord.create(roomid, mod);
  await emitRecord(record);
  return record;
}

async function findBan(type, ip, account) {
  const active = [];
  if (ip) {
    await ACTIVEIP.loaded;
    const iactive = ACTIVEIP.get(ip);
    if (!iactive) {
      // ignored
    }
    else if (!iactive.any) {
      ACTIVEIP.delete(ip);
    }
    else if (iactive[type]) {
      active.push(iactive[type]);
    }
  }
  if (account) {
    await ACTIVEACCT.loaded;
    const aactive = ACTIVEACCT.get(account);
    if (!aactive) {
      // ignored
    }
    else if (!aactive.any) {
      ACTIVEIP.delete(account);
    }
    else if (aactive[type]) {
      active.push(aactive[type]);
    }
  }
  if (!active.length) {
    return null;
  }
  if (active.length === 1) {
    return active[0];
    // This will trigger an update in clients
  }
  return active[0].expires > active[1].expires ?
    active[0] :
    active[1];
}

function recordFromData(data) {
  switch (data.recordType) {
  case "ban":
    return new BanRecord(data);

  case "unban":
    return new UnbanRecord(data);

  case "whitelist":
    return new WhitelistRecord(data);

  case "nuke":
    return new NukeRecord(data);

  default:
    throw new Error("Invalid record type");
  }
}

async function getModLogs() {
  const keys = await redis.keys(`${MODLOG}*`);
  if (!keys.length) {
    return [];
  }
  const records = (await redis.mget(...keys)).
    filter(e => e).
    map(e => recordFromData(JSON.parse(e)));
  records.forEach(r => {
    r.time = toPrettyDuration(Date.now() - r.issued, true);
    r.text = messageToText(r.toLogMessage());
  });
  return sort(records, r => -r.issued);
}

async function lookupLog(id) {
  let record = await redis.get(toKey({id}));
  if (!record) {
    return null;
  }
  record = recordFromData(JSON.parse(record));
  record.text = messageToText(record.toLogMessage());
  return record;
}

module.exports = {
  ban,
  unban,
  whitelist,
  nuke,
  findBan,
  recordFromData,
  getModLogs,
  lookupLog,
};
