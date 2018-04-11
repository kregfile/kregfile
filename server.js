"use strict";

const cluster = require("cluster");
const numCPUs = require("os").cpus().length;


if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  // Fork workers.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  /*
  const BROKER = require("./broker");
  setInterval(function news() {
    BROKER.emit("message", {
      user: "News",
      role: "system",
      msg: "now with 100% more rice",
      volatile: true
    });
  }, 5000);
  */
}
else {
  require("./lib/server");
}
