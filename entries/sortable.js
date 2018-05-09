"use strict";

import {debounce, sort, naturalCaseSort} from "client/util";

function colToSort(col) {
  if (!col) {
    return null;
  }
  return col.dataset.sort || col.textContent;
}

function sortTable(col, idx) {
  const rows = sort(Array.from(table.querySelectorAll("tbody > tr")), r => {
    const cols = Array.from(r.querySelectorAll("td"));
    const scol = cols[idx];
    if (!scol || !idx) {
      return [colToSort(cols[0])];
    }
    return [colToSort(scol), colToSort(cols[0])];
  }, naturalCaseSort);
  if (col.dataset.order === "r") {
    rows.reverse();
  }
  const owner = rows[0].parentElement;
  rows.forEach(r => owner.appendChild(r));
}

function filterTable() {
  const rows = Array.from(table.querySelectorAll("tbody > tr"));
  const f = filter.value.trim().toUpperCase();
  if (!f) {
    rows.forEach(r => {
      r.classList.remove("hidden");
    });
    return;
  }
  rows.forEach(r => {
    const rf = r.dataset.filter.toUpperCase();
    if (rf.includes(f)) {
      r.classList.remove("hidden");
    }
    else {
      r.classList.add("hidden");
    }
  });
}

const table = document.querySelector(".sortable");
const cols = Array.from(table.querySelectorAll("th"));
cols.forEach((c, i) => {
  c.addEventListener("click", () => {
    sortTable(c, i);
  });
  if (c.dataset.default) {
    sortTable(c, i);
  }
});

const filter = document.querySelector("#filter");
if (filter) {
  filter.addEventListener("keydown", debounce(filterTable));
}
