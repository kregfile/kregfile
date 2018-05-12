"use strict";

import registry from "./registry";
import {validateUsername, toMessage} from "./util";
import nacl from "tweetnacl";
import nutil from "tweetnacl-util";

export default new class PrivMessage {
  constructor() {
    this.onpubkey = this.onpubkey.bind(this);
    this.onprivmsg = this.onprivmsg.bind(this);
    const key = localStorage.getItem("sekrit");
    try {
      if (!key) {
        throw new Error("no key");
      }
      const pair = nacl.box.keyPair.fromSecretKey(
        nutil.decodeBase64(key));
      Object.assign(this, pair);
    }
    catch (ex) {
      const pair = nacl.box.keyPair();
      Object.assign(this, pair);
      localStorage.setItem("sekrit", nutil.encodeBase64(this.secretKey));
    }
  }

  init() {
    registry.socket.on("pubkey", this.onpubkey);
    registry.socket.on("privmsg", this.onprivmsg);
  }

  onpubkey() {
    registry.socket.emit("pubkey", nutil.encodeBase64(this.publicKey));
  }

  async onprivmsg(m) {
    let {msg, nounce, publicKey} = m;
    delete m.msg;
    delete m.nounce;
    delete m.publicKey;
    try {
      [msg, nounce, publicKey] =
        [msg, nounce, publicKey].map(nutil.decodeBase64);
      m.msg = await toMessage(nutil.encodeUTF8(
        nacl.box.open(msg, nounce, publicKey, this.secretKey)));
      m.channel = "Private";
      m.notify = true;
    }
    catch (ex) {
      m.msg = `Could not decode privmsg: ${ex.message || ex}`;
    }
    registry.messages.add(m);
  }

  async command(m) {
    const {socket: s} = registry;
    const idx = m.match(/\s/);
    if (!idx) {
      throw new Error("Invalid private message, use <user> <msg>");
    }
    const u = m.slice(0, idx.index).trim();
    const user = u.toLowerCase();
    m = m.slice(idx.index).trim();
    await validateUsername(user);

    let pubkey = await s.makeCall("reqpubkey", user);
    if (!pubkey) {
      throw new Error("User not available right now");
    }
    pubkey = nutil.decodeBase64(pubkey);
    const nounce = nacl.randomBytes(nacl.box.nonceLength);
    let msg = m.padEnd(m.length + 256 + (m.length % 256));
    msg = nacl.box(nutil.decodeUTF8(msg), nounce, pubkey, this.secretKey);
    s.emit("privmsg", {
      msg: nutil.encodeBase64(msg),
      nounce: nutil.encodeBase64(nounce),
      publicKey: nutil.encodeBase64(this.publicKey),
      user
    });
    registry.messages.add({
      user: `Private to ${u}`,
      role: "system",
      msg: await toMessage(`${m}`)
    });
    return true;
  }
}();
