"use strict";

const {HTTP_PORT: port = 8080} = process.env;

module.exports = {
  port,
  secret: "kregfile",
  uploads: "uploads",
};
