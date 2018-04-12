module.exports = {
  entry: "./main.js",
  output: {
    path: `${__dirname}/../static/`,
    filename: "client.js"
  },
  devtool: "source-map",
  resolve: {
    alias: {
      "localforage$": "../node_modules/localforage/dist/localforage.nopromises.min.js",
      "socket.io-client": "../node_modules/socket.io-client/dist/socket.io.slim.js",
    }
  }
};
