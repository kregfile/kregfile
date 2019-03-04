"use strict;";

import qrcode from "qrcode";

const acct = document.querySelector("#account");
acct.addEventListener("submit", async e => {
  e.preventDefault();
  e.stopPropagation();
  const opts = {
    realm: "acct",
  };
  for (const i of ["#token", "#email", "#message"]) {
    opts[i.slice(1)] = document.querySelector(i).value;
  }
  for (const i of ["#pubmail"]) {
    opts[i.slice(1)] = document.querySelector(i).checked;
  }

  const submit = document.querySelector("#submit");
  submit.setAttribute("disabled", "disabled");
  const oldval = submit.textContent;
  submit.textContent = "Please wait...";
  try {
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    let res = await fetch("/api/account", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(opts)
    });
    if (!res.ok) {
      throw new Error("Server err'ed out, sorry! Please try again later");
    }
    res = await res.json();
    if (res.err) {
      throw new Error(res.err);
    }
    alert("Saved!");
  }
  catch (ex) {
    alert(ex.message || ex);
    console.trace(ex);
  }
  finally {
    submit.textContent = oldval;
    submit.removeAttribute("disabled");
  }
});


const tfa = document.querySelector("#tfa");
const challenger = document.querySelector("#challenger");

async function tfaGetChallenge() {
  try {
    const opts = {
      realm: "tfa",
      token: document.querySelector("#token").value,
      enable: true,
      challenge: null
    };
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    let res = await fetch("/api/account", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(opts)
    });
    if (!res.ok) {
      throw new Error("Server err'ed out, sorry! Please try again later");
    }
    res = await res.json();
    if (res.err) {
      throw new Error(res.err);
    }
    if (!res.challenge) {
      throw new Error("challenge");
    }
    const {challenge} = res;
    challenger.style.display = "block";
    const qr = document.querySelector("#qr");
    await new Promise((res, rej) => {
      qrcode.toCanvas(qr, challenge, {
        errorCorrectionLevel: "H",
        scale: 5,
        margin: 5,
      }, e => e ? rej(e) : res());
    });
    tfa.dataset.enabled = "challenge";
    document.querySelector("#tfasubmit").scrollIntoView(false);
    document.querySelector("#challenged").focus();
  }
  catch (ex) {
    alert(ex.message || ex);
    console.trace(ex);
  }
}

async function tfaDisable() {
  try {
    const opts = {
      realm: "tfa",
      token: document.querySelector("#token").value,
      enable: false,
    };
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    let res = await fetch("/api/account", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(opts)
    });
    if (!res.ok) {
      throw new Error("Server err'ed out, sorry! Please try again later");
    }
    res = await res.json();
    if (res.err) {
      throw new Error(res.err);
    }
    alert("Disabled!");
    tfa.textContent = "Enable";
    tfa.dataset.enabled = "false";
    challenger.style.display = "none";
  }
  catch (ex) {
    alert(ex.message || ex);
    console.trace(ex);
  }
}

async function tfaComplete() {
  try {
    const opts = {
      realm: "tfa",
      token: document.querySelector("#token").value,
      enable: true,
      challenge: document.querySelector("#challenged").value,
    };
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    let res = await fetch("/api/account", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(opts)
    });
    if (!res.ok) {
      throw new Error("Server err'ed out, sorry! Please try again later");
    }
    res = await res.json();
    if (res.err) {
      throw new Error(res.err);
    }
    alert("Enabled!");
    tfa.textContent = "Disable";
    tfa.dataset.enabled = "true";
    challenger.style.display = "none";
  }
  catch (ex) {
    alert(ex.message || ex);
    console.trace(ex);
  }
}

async function tfaHandler(e) {
  e.preventDefault();
  e.stopPropagation();
  switch (tfa.dataset.enabled) {
  case "false":
    await tfaGetChallenge();
    return;

  case "true":
    await tfaDisable();
    return;

  case "challenge":
    await tfaComplete();
    return;
  }
}

tfa.addEventListener("click", tfaHandler);
tfa.form.addEventListener("submit", tfaHandler);

