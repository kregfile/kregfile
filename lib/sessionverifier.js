"use strict";

const crypto = require("crypto");

function generate(secret, session) {
  return crypto.createHmac("sha256", secret).
    update(Buffer.from(session, "utf-8")).
    digest("base64").
    replace(/=/g, "").replace(/\//g, "_").replace(/\+/g, "-");
}

/**
 * Verifies a session verifier attempt
 *
 * @param {string} secret A secret
 * @param {string} session The session identifier to verify
 * @param {string} attempt The user provided attempt
 * @param {string} n The user provided nonce
 * @returns {boolean} Result of verification
 */
function verify(secret, session, attempt, n) {
  attempt = `${attempt}`;
  try {
    n = Buffer.from(n, "base64");
  }
  catch (ex) {
    return false;
  }
  if (!n || n.length < 9 || !attempt) {
    return false;
  }
  const verifier = secret && session ?
    generate(secret, session) :
    generate("bogus", "bogus");
  const expected = generate(n, verifier);
  return expected === attempt;
}

module.exports = {
  generate, verify
};
