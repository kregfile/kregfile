"use strict";

const crypto = require("crypto");
const path = require("path");
const {RawSource} = require("webpack-sources");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const UglifyJsPlugin = require("uglifyjs-webpack-plugin");
const OptimizeCSSAssetsPlugin = require("optimize-css-assets-webpack-plugin");

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
    style: "./css/style.css",
  },
  output: {
    filename: "[name].js",
    path: path.join(__dirname, "static"),
    publicPath: "/static/",
    chunkFilename: "[name].js?v=[chunkhash]",
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          "css-loader"
        ]
      },
      {
        test: /\.(png|jpg|gif|woff2?|ttf|svg|otf|eof)$/,
        use: [
          {
            loader: "file-loader",
            options: {
              name: "s~[hash].[ext]",
            }
          }
        ]
      }
    ]
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: "[name].css"
    }),
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
  },
  optimization: {
    minimizer: [
      new UglifyJsPlugin({
        cache: true,
        parallel: true,
        sourceMap: true,
      }),
      new OptimizeCSSAssetsPlugin({
        cssProcessor: require("cssnano"),
        cssProcessorOptions: {
          preset: "default",
          discardComments: { removeAll: true },
        },
      })
    ]
  },
};
