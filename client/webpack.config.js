"use strict";

const crypto = require("crypto");
const {RawSource, ConcatSource} = require("webpack-sources");

class HashPlugin {
  apply(compiler) {
    compiler.hooks.emit.tap("HashPlugin", compilation => {
      try {
        const client = compilation.assets["client.js"];
        const d = crypto.
          createHmac("sha224", "kregfile").
          update(client.source()).
          digest("hex").slice(0, 10);
        const newClient = new ConcatSource(
          `const CLIENT_VERSION = '${d}';`,
          client);
        compilation.assets["client.js"] = newClient;
        compilation.assets["../lib/clientversion.js"] =
          new RawSource(`module.exports = '${d}';`);
      }
      catch (ex) {
        console.error(ex);
      }
    });
  }
}

module.exports = {
  mode: "development",
  entry: "./main.js",
  output: {
    path: `${__dirname}/../static/`,
    filename: "client.js"
  },
  plugins: [new HashPlugin()],
  devtool: "source-map",
  resolve: {
    alias: {
      "localforage$":
        "../node_modules/localforage/dist/localforage.nopromises.min.js",
      "socket.io-client":
        "../node_modules/socket.io-client/dist/socket.io.slim.js",
    }
  }
};
