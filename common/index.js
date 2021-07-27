"use strict";

const {memoize} = require("./memoize");

function debounce(fn, to) {
  if (fn.length) {
    throw new Error("cannot have params");
  }
  to = to || 100;
  let timer;

  const run = function() {
    timer = 0;
    fn.call(this);
  };

  return function() {
    if (timer) {
      return;
    }
    timer = setTimeout(run.bind(this), to);
  };
}

function parseCommand(str) {
  if (str[0] !== "/" || str[1] === "/") {
    return null;
  }

  const idx = str.indexOf(" ");
  const found = idx >= 0;
  const [cmd, args] = [
    (found ? str.slice(1, idx) : str.slice(1)).trim().toLowerCase(),
    (found ? str.slice(idx) : "").trim()
  ];
  return {
    cmd,
    args,
    str
  };
}

function mixin(obj, other) {
  for (const o of [other, Object.getPrototypeOf(other)]) {
    if (!o) {
      continue;
    }
    for (const [k, v] of Object.entries(o)) {
      if (typeof v !== "function") {
        continue;
      }
      obj[k] = o[k].bind(other);
    }
  }
}

function plural(s, single, plural) {
  if (s === 1) {
    return `${s} ${single}`;
  }
  return `${s} ${plural}`;
}

const toPrettySize = (function() {
const formatters = new Map();
const units = [
  " B",
  " KiB",
  " MiB",
  " GiB",
  " TiB",
  " PiB",
  " EiB",
  " MercoByte"
];

const fixer = function(digits) {
  let f = formatters.get(digits);
  if (!f) {
    // eslint-disable-next-line
    formatters.set(digits, f = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: false
    }));
  }
  return f;
};

return function prettySize(n) {
  let o = 0;
  let f = 0;
  while (n > 1024) {
    n /= 1024;
    ++o;
  }
  if (!o) {
    return `${n.toFixed(0)} B`;
  }
  if (n < 10) {
    f = 2;
  }
  else if (n < 100) {
    f = 1;
  }
  if (o > 3) {
    // large size force multiplier: adds +3cp
    ++f;
  }
  return fixer(f).format(n) + units[o];
};
})(false);

const toPrettyInt = (function() {
// eslint-disable-next-line
const formatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});
return function(number) {
  return formatter.format(number);
};
})();

function toPrettyDuration(s, short) {
  s = Math.floor(s / 1000);
  const rv = [];
  if (s >= 31536000) {
    const c = s / 31536000;
    if (short) {
      return plural(Math.round(c), "year", "years");
    }
    rv.push(plural(Math.floor(c), "year", "years"));
    s %= 31536000;
  }
  if (s >= 604800) {
    const c = s / 604800;
    if (short) {
      return plural(Math.round(c), "week", "weeks");
    }
    rv.push(plural(Math.floor(c), "week", "weeks"));
    s %= 604800;
  }
  if (s >= 86400) {
    const c = s / 86400;
    if (short) {
      return plural(Math.round(c), "day", "days");
    }
    rv.push(plural(Math.floor(c), "day", "days"));
    s %= 86400;
  }
  if (s >= 3600) {
    const c = s / 3600;
    if (short) {
      return plural(Math.round(c), "hour", "hours");
    }
    rv.push(plural(Math.floor(c), "hour", "hours"));
    s %= 3600;
  }
  if (s >= 60) {
    const c = s / 60;
    if (short) {
      return plural(Math.round(c), "min", "mins");
    }
    rv.push(plural(Math.floor(c), "min", "mins"));
    s %= 60;
  }
  if (s) {
    if (short) {
      return `${Math.round(s)} s`;
    }
    rv.push(`${Math.floor(s)} s`);
  }
  return rv.join(" ");
}

const toPrettyETA = (function() {
// eslint-disable-next-line
const fmt = new Intl.NumberFormat(undefined, {
  minimumIntegerDigits: 2,
  maximumFractionDigits: 0
});
return function toPrettyETA(s) {
  const rv = [];
  let c = Math.floor(s / 86400);
  if (c > 0) {
    rv.push(fmt.format(c), "::");
  }
  s %= 86400;

  c = Math.floor(s / 3600);
  if (c > 0) {
    rv.push(fmt.format(c), ":");
  }
  s %= 3600;

  c = s / 60;
  rv.push(fmt.format(c), ":");
  s %= 60;

  rv.push(fmt.format(s));
  return rv.join("");
};
})();

function ofilter(o, set) {
  const rv = {};
  for (const k of set.values()) {
    // eslint-disable-next-line no-prototype-builtins
    if (o.hasOwnProperty(k)) {
      rv[k] = o[k];
    }
  }
  return rv;
}

class CoalescedUpdate extends Set {
  constructor(to, cb) {
    super();
    this.to = to;
    this.cb = cb;
    this.triggerTimer = 0;
    this.trigger = this.trigger.bind(this);
    Object.seal(this);
  }

  add(s) {
    super.add(s);
    if (!this.triggerTimer) {
      this.triggerTimer = setTimeout(this.trigger, this.to);
    }
  }

  trigger() {
    this.triggerTimer = 0;
    if (!this.size) {
      return;
    }
    const a = Array.from(this);
    this.clear();
    this.cb(a);
  }
}

function randint(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

function shuffle(array) {
  for (let i = array.length; i; i--) {
    const j = Math.floor(Math.random() * i);
    [array[i - 1], array[j]] = [array[j], array[i - 1]];
  }
  return array;
}

function sleep(to) {
  return new Promise(r => setTimeout(r, to));
}


module.exports = {
  CoalescedUpdate,
  debounce,
  mixin,
  ofilter,
  parseCommand,
  memoize,
  toPrettyDuration,
  toPrettyETA,
  toPrettyInt,
  toPrettySize,
  shuffle,
  randint,
  sleep,
  plural,
};

// No dynamic requires to not confuse webpack!
Object.assign(module.exports, require("./sorting"));
Object.assign(module.exports, require("./promisepool"));
Object.assign(module.exports, require("./omap"));
Object.assign(module.exports, require("./oset"));
Object.assign(module.exports, require("./oset"));
Object.assign(module.exports, require("./iter"));
