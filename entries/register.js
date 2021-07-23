"use strict;";

import {dom, formToJSON, validateUsername} from "client/util";


const form = document.querySelector("#register");
form.addEventListener("submit", async e => {
  e.preventDefault();
  e.stopPropagation();
  const body = new FormData(form);
  const user = body.get("u");
  const pass = body.get("p");
  const confirm = body.get("c");
  body.delete("c");

  const errors = [];
  try {
    if (await validateUsername(user) !== user) {
      errors.push(`Invalid user name:
      no special chars, like umlauts or accented characters!`);
    }
  }
  catch (ex) {
    errors.push(ex.message || ex);
  }
  if (pass !== confirm) {
    errors.push(`Passwords did not match,
    please make sure to supply the same password twice!`);
  }
  if (pass.length < 8) {
    errors.push("Password too short!");
  }
  if (!/\w/.test(pass) || !/\d/.test(pass)) {
    errors.push(`Password must contain at least
    one regular character and one number`);
  }
  const ul = document.querySelector("#errors");
  ul.textContent = "";
  errors.forEach(error => {
    ul.appendChild(dom("li", {text: error}));
  });
  if (errors.length) {
    return;
  }

  const submit = document.querySelector("#submit");
  submit.setAttribute("disabled", "disabled");
  const oldval = submit.textContent;
  submit.textContent = "Please wait...";

  try {
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    let res = await fetch("/api/register", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: formToJSON(body),
    });
    if (!res.ok) {
      throw new Error("Server err'ed out, sorry! Please try again later");
    }
    res = await res.json();
    if (res.err) {
      throw new Error(res.err);
    }
    if (window.PasswordCredential) {
      const cred = new window.PasswordCredential({
        id: body.get("u").toLowerCase(),
        password: body.get("p")
      });
      try {
        await navigator.credentials.store(cred);
      }
      catch (ex) {
        console.error("Failed to save cred", ex);
      }
    }
    document.location = "/account";
  }
  catch (ex) {
    ul.appendChild(dom("li", {text: ex.message || ex}));
    console.trace(ex);
  }
  finally {
    submit.textContent = oldval;
    submit.removeAttribute("disabled");
  }
});

