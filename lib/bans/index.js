"use strict";

const BROKER = require("../broker");
const {DistributedMap} = require("../broker/collections");
const {BanRecord} = require("./banrecord");
const {UnbanRecord} = require("./unbanrecord");
const {WhitelistRecord} = require("./whitelistrecord");
const {ActiveBan} = require("./activeban");

const MODLOG = "modlog";

const redis = BROKER.getMethods(
  "lpush",
);

const ACTIVEACCT = new DistributedMap(
  "activebans:account", d => ActiveBan.fromData(d));
const ACTIVEIP = new DistributedMap(
  "activebans:ip", d => ActiveBan.fromData(d));

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

async function emitRecord(record) {
  await redis.lpush(MODLOG, JSON.stringify(record));
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

  default:
    return null;
  }
}

module.exports = {
  ban,
  unban,
  whitelist,
  findBan,
  recordFromData,
};
