"Use strict";

const {Expirer: UploadExpirer} = require("./upload");

const UEXPIRER = new UploadExpirer();

async function expireOnce() {
  await UEXPIRER.expire();
}

async function expire() {
  try {
    await expireOnce();
  }
  catch (ex) {
    console.error("Expiration failed", ex);
  }
  setTimeout(expire, 10000);
}

console.log(`Expiration ${process.pid.toString().bold} is running`);
expire();
