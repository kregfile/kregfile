"use strict";

const {DistributedTracking} = require("./broker/dtracking");


const clients = new DistributedTracking("clients");

module.exports = {
  clients
};
