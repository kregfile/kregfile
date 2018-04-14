"use strict";

const {DistributedTracking} = require("./broker/dtracking");


const clients = new DistributedTracking("clients");
const floods = new DistributedTracking("floods");

module.exports = {
  clients,
  floods
};
