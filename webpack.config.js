"use strict";

const crypto = require("crypto");
const path = require("path");
const {RawSource} = require("webpack-sources");

class HashPlugin {
  apply(compiler) {
    compiler.hooks.emit.tap("HashPlugin", compilation => {
      const d = crypto.createHmac("sha224", "kregfile");
      for (const a of Object.values(compilation.assets)) {
        try {
          d.update(a.source());
        }
        catch (ex) {
          console.error(ex);
        }
      }
      compilation.assets["../lib/clientversion.js"] =
        new RawSource(`module.exports = '${d.digest("hex").slice(0, 10)}';`);
    });
  }
}

module.exports = {
  mode: "development",
  node: {
    Buffer: false,
  },
  context: path.join(__dirname, "entries"),
  entry: {
    client: "./main.js",
    register: "./register.js",
    account: "./account.js",
    sortable: "./sortable.js",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "static"),
  },
  plugins: [
    new HashPlugin(),
  ],
  devtool: "source-map",
  resolve: {
    modules: [
      "./",
      "node_modules",
    ],
    alias: {
      localforage: "node_modules/localforage/dist/localforage.nopromises.js",
    }
  }
};
