module.exports = {
  entry: "./main.js",
  output: {
    path: `${__dirname}/../static/`,
    filename: "client.js"
  },
  devtool: "source-map",
};
