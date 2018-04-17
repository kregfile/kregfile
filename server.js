"use strict";

require("./lib/loglevel").patch();
const config = require("./lib/config");
const cluster = require("cluster");

const EXPIRATION_WORKER = "KREGFILE_EXPIRATION_WORKER";

function master() {
  const os = require("os");

  const NUM_CPUS = os.cpus().length;

  console.log(`Master ${process.pid.toString().bold} is running`);

  // Fork workers.
  for (let i = 0; i < NUM_CPUS; i++) {
    cluster.fork();
  }

  // Fork the file expiration worker
  cluster.fork(Object.assign({}, process.env, {
    [EXPIRATION_WORKER]: 1
  }));

  console.log(`Point your browser to http://0.0.0.0:${config.get("port")}/r/test`);
}

if (cluster.isMaster) {
  master();
}
else if (process.env[EXPIRATION_WORKER]) {
  require("./lib/expiration");
}
else {
  require("./lib/httpserver");
}
