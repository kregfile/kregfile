"use strict";

require("colors");
const {format} = require("util");
const {parse} = require("path");

const LEVELS = Object.freeze(new Map([
  ["critical", 1],
  ["error", 2],
  ["warn", 10],
  ["info", 20],
  ["log", 20],
  ["debug", 30],
  ["trace", 30],
]));

const COLORS = Object.freeze(new Map([
  ["critical", "red.bold"],
  ["error", "red"],
  ["warn", "yellow"],
  ["info", "white"],
  ["debug", "dim"],
  ["trace", "gray"],
]));

const ALIASES = Object.freeze(new Map([
  ["log", "info"]
]));

const CONSOLE_TEE_PASSTHROUGH = Object.freeze(new Set([
  "Console",
  "level",
]));


const MAX_LENGTH = Array.from(LEVELS.keys()).
  map(e => `[]${e}`).
  reduce((p, c) => Math.max(p, c.length), 0);

const PAD_NAME = 14;

const NOT = Object.freeze(new Set(["index", "lib", "bot"]));

const N_A = "(n/a)";

const ADOPTED = new WeakSet();
const PER_LEVELS = new WeakMap();

let LEVEL = 0;

class TeeFailure extends TypeError {
}

Object.assign(TeeFailure.prototype, {
  name: "TeeFailure",
});

const CONSOLE_TEE_PROXY_HANDLER = Object.freeze({
  "get"(tee, property) {
    if (CONSOLE_TEE_PASSTHROUGH.has(property)) {
      return tee.firstConsole[property];
    }

    const cached = tee.methodCache.get(property);
    if (cached) {
      return cached;
    }

    const cand = tee.firstConsole[property];
    if (typeof cand === "undefined") {
      throw new TeeFailure(`Teed console does not implement method "${property}"!`);
    }
    if (typeof cand !== "function") {
      throw new TeeFailure(`Property "${property}" of teed console is not a function!`);
    }

    const props = tee.consoles.map(
      console => ({console, method: console[property]}));
    const caller = function(...args) {
      for (const p of props) {
        try {
          p.method.apply(p.console, args);
        }
        catch (ex) {
          // ignore
        }
      }
    };
    tee.methodCache.set(property, caller);
    return caller;
  }
});

/**
 * Tee-s together multiple consoles
 */
class ConsoleTee {
  /**
   * Tee-s together multiple consoles
   * @param {Console[]} consoles The consoles to be teed
   * @returns {Console-like} Tee over given consoles
   */
  constructor(...consoles) {
    if (!consoles.length) {
      throw new TeeFailure("No consoles provided");
    }
    Object.defineProperty(this, "consoles", {
      value: Array.from(consoles)
    });
    Object.defineProperty(this, "firstConsole", {
      value: this.consoles[0]
    });
    Object.defineProperty(this, "methodCache", {
      value: new Map()
    });
    Object.freeze(this);
    return new Proxy(this, CONSOLE_TEE_PROXY_HANDLER);
  }
}

class StackName {
  constructor(handler) {
    this.handler = handler;
    Object.freeze(this);
  }

  get current() {
    const rv = {};
    Error.captureStackTrace(rv, this.handler);
    return rv;
  }

  resolve(path) {
    // Chop away level from the stack file path until we find something
    // suitable;
    let {name, dir} = parse(path);
    while (name || dir) {
      if (!name || NOT.has(name)) {
        ({name, dir} = parse(dir));
        continue;
      }
      return name;
    }
    return "";
  }

  nameFor(args) {
    // Find any object with a .stack property and extract it.
    // Use live stack, if not available
    let {stack} = args.find(e => {
      return e && typeof e.stack === "string" && e.stack;
    }) || this.current;
    if (!stack) {
      // Nothing, give up. Basically, the world is broken.
      return N_A;
    }

    // We're only interested in code locations outside of this module.
    // First line is the message, so skip it.
    stack = stack.toString().
      split("\n").
      find((e, i) => i && !e.includes(__filename));

    if (!stack) {
      // Yeah, that didn't exactly work out, compute from live stack, and
      // don't ignore ourselves this time.
      const {stack: fallback = ""} = this.current;
      [, stack] = fallback.split("\n");
      if (!stack) {
        // Still nothing, give up. Basically, the world is broken.
        return N_A;
      }
    }

    // Give me the sweet, sweet file information only.
    stack = stack.trim();
    const path = stack.match(/\((.+?)\)$/);
    if (!path) {
      return stack;
    }
    return this.resolve(path[1]) || N_A;
  }
}

/**
 * Sets the level
 * @param {string} level Level to set
 * @param {Console} [console] If provided, set the level only for this console
 *   instead globally
 */
function setLevel(level, console) {
  const resolved = LEVELS.get(level);
  if (!resolved) {
    throw new Error(`Not a valid log level: ${level}`);
  }
  if (!console) {
    LEVEL = resolved;
  }
  else {
    PER_LEVELS.set(console, resolved);
  }
}

/**
 * Patch a Console to make it into a logger.
 * Said logger will then provide along with the usual log facilities of Console
 *  - `.critical(...)`
 *  - `.debug(...)`
 *  - `.trace(...)`
 *
 * Logged objects may furthermore implement `toLogMessage({bool} colors)` which
 * is called prior to usual console formatting.
 *
 * @param {Console} [console] Console to patch (or global console if omitted)
 * @param {Object} [options] Additional options for for the logger creation
 * @param {bool} [options.colors] Turn on or off colors
 * @param {String} [options.level] Specify a level different to the global level
 * @param {String} [options.name] Specify a hardcoded name for the logger
 * @param {String} [options.levelColors]
 *   An object or Map specifying some or all colors for log levels
 * @returns {Console} The patched Console instance (fluent)
 */
function patch(console, options) {
  console = console || global.console;
  if (ADOPTED.has(console)) {
    return console;
  }
  ADOPTED.add(console);

  options = options || {};
  const {colors = true} = options;

  const toLogMessage = function(item) {
    try {
      if (item && item.toLogMessage) {
        return item.toLogMessage(colors);
      }
    }
    catch (ex) {
      // ignored
    }
    return item;
  };

  const rebind = function(orig, color) {
    const method = ALIASES.get(orig) || orig;
    const lvl = LEVELS.get(method);
    let fmtMethod = method.toUpperCase();
    if (colors) {
      for (const fmt of color.split(".")) {
        fmtMethod = fmtMethod[fmt];
      }
    }
    fmtMethod = `[${fmtMethod}${"]".padEnd(MAX_LENGTH - method.length)}`;
    const bound = console[orig].bind(console);

    const namer = new StackName((...args) => {
      const clevel = PER_LEVELS.get(console) || LEVEL;
      if (lvl > clevel) {
        return false;
      }

      const date = new Date().toUTCString();
      const fmtDate = `[${colors ? date.bold.blue : date}]`;
      const fmtPID = `[${colors ? process.pid.toString().bold.yellow : process.pid}]`;
      const fmtArgs = args.map(toLogMessage);
      try {
        const name = namer.nameFor(args);
        const fmtName = colors ? name.bold.green : name;
        bound(
          fmtDate,
          fmtPID,
          `[${fmtName}${"]".padEnd(PAD_NAME - name.length)}`,
          fmtMethod,
          ...fmtArgs);
      }
      catch (ex) {
        bound(fmtDate, fmtPID, fmtMethod, ...fmtArgs);
      }
      return true;
    });
    console[orig] = namer.handler;
  };

  // Add some more levels and .trace
  const log = console.log.bind(console);
  console.debug = log;
  console.critical = log;
  console.trace = function trace(...args) {
    const err = {
      name: "",
      message: format.apply(null, args)
    };
    Error.captureStackTrace(err, trace);
    log(err.stack);
  };

  // Map all levels to colors
  const {levelColors = {}} = options;
  const mapped = new Map();
  LEVELS.forEach((val, key) => {
    const alias = ALIASES.get(key) || key;
    const activeColor = levelColors[alias] ||
      (levelColors.get && levelColors.get(alias)) ||
      COLORS.get(alias);
    mapped.set(key, activeColor);
  });

  // ... and rebind
  mapped.forEach((color, lvl) => {
    rebind(lvl, color);
  });

  // Set the level if specified
  const {level: olevel} = options;
  if (olevel) {
    setLevel(olevel, console);
  }

  return console;
}

/**
 * Installs the corresponding logger(s) as the new global console
 * @param {Console[]} consoles
 * @returns {Console} The new global console (fluent)
 */
function install(...consoles) {
  Object.defineProperty(global, "console", {
    value: new ConsoleTee(...consoles.map(c => patch(c))),
    enumerable: true,
    configurable: true
  });
  return global.console;
}

setLevel("info");

module.exports = { patch, install, setLevel, ConsoleTee };

if (require.main === module) {
  // bullshit "tests"
  patch();
  console.log("hello");
  console.info("hello again");
  console.critical("critical");
  console.debug("not visible");
  setLevel("debug");
  console.debug("visible");
  console.debug("fake", {stack: "fake stack\n(fake/reallyfake)"});
  console.debug("faker", {stack: {fake: "fake stack"}});
  try {
    setLevel("nah");
  }
  catch (ex) {
    console.error("not valid", ex);
    console.warn("be more careful");
  }
  console.trace("writing VB application to trace the perp!");
  setLevel("info");
  console.trace("writing VB application to trace the perp!");
  const cons2 = new console.Console(process.stdout);
  const cons3 = patch(new console.Console(process.stdout), {
    level: "error",
    levelColors: new Map([["error", "cyan"], ["critical", "bold"]]),
  });
  const cons4 = patch(
    new console.Console(process.stdout), {colors: 0});
  const cons5 = patch(new console.Console(process.stdout), {
    colors: "yes",
    levelColors: {
      info: "magenta",
      error: "blue",
      critical: "green",
    }
  });
  const tee = new ConsoleTee(
    console, new ConsoleTee(cons2, cons3), new ConsoleTee(cons4, cons5));
  tee.info("tee test0");
  tee.error("tee test");
  tee.info("tee test2");
  tee.info("customized", {toLogMessage(colors) {
    return colors ? "message".red : "message";
  }});

  try {
    tee.critical("should throw because plain consoles do not implement it");
  }
  catch (ex) {
    install(console, cons3, cons5);
    console.critical("implemented!", ex);
  }
  console.log("over and out");
}
