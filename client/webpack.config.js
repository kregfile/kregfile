"use strict";

const crypto = require("crypto");
const path = require("path");
const {RawSource} = require("webpack-sources");

class HashPlugin {
  apply(compiler) {
    compiler.hooks.emit.tap("HashPlugin", compilation => {
      try {
        const client = compilation.assets["client.js"];
        const d = crypto.
          createHmac("sha224", "kregfile").
          update(client.source()).
          digest("hex").slice(0, 10);
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
    path: path.join(__dirname, "..", "static"),
    filename: "client.js"
  },
  plugins: [new HashPlugin()],
  devtool: "source-map",
  resolve: {
    modules: [
      "../node_modules",
    ],
  }
};
