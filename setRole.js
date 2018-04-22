#!/usr/bin/env node
"use strict";

require("./lib/loglevel").patch();
const {User} = require("./lib/user");

async function main() {
  const [,, acct, role] = process.argv;
  if (!acct || !role) {
    console.error("setRole.js <user> <role>");
    process.exit(1);
    return;
  }
  const user = await User.get(acct);
  if (!user) {
    console.error("Invalid user");
    process.exit(1);
    return;
  }
  console.log("setting role", role.bold.red, "on", acct.bold);
  user.role = role;
  await user.save();
  console.log("Role set!".bold);
  process.exit(0);
}

main().catch(console.error);
