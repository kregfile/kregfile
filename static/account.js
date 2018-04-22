"use strict;";

const form = document.querySelector("#account");
form.addEventListener("submit", async e => {
  e.preventDefault();
  e.stopPropagation();
  const opts = {};
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

