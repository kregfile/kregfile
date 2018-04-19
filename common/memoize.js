"use strict";
/* eslint-disable no-magic-numbers */

const DEFAULT_LIMIT = 3000;

/**
 * Memoize a function aka cache the result of a function based on the arguments.
 * The function parameters must be JSONable, and the function may not be
 * varadic.
 *
 * @param {Function} func Function to memoize
 * @param {Integer} [limit] How many entries to keep in cache
 * @param {Integer} [num_args] Override the argument count
 * @returns {Function} memoized wrapper
 */
function memoize(func, limit, num_args) {
  limit = limit || DEFAULT_LIMIT;
  num_args = num_args || func.length;

  const cache = Object.create(null);
  const order = [];
  //
  // reusable array for key generation to avoid creating many arrays
  const args = [];

  /* we special case 0-4 argc functions for performance reasons */
  switch (num_args) {
  case 0:
    throw Error("memoize does not support functions without arguments");

  case 1:
    return function memoize_one_arg(a) {
      const key = a.toString();

      if (key in cache) {
        return cache[key];
      }

      const result = func(a);
      cache[key] = result;
      if (order.push(key) > limit) {
        delete cache[order.shift()];
      }
      return result;
    };

  case 2:
    return function memoize_two_args(a, b) {
      args[0] = a; args[1] = b;
      const key = JSON.stringify(args);
      args.length = 0;

      if (key in cache) {
        return cache[key];
      }

      const result = func(a, b);
      cache[key] = result;
      if (order.push(key) > limit) {
        delete cache[order.shift()];
      }
      return result;
    };

  case 3:
    return function memoize_three_args(a, b, c) {
      args[0] = a; args[1] = b; args[2] = c;
      const key = JSON.stringify(args);
      args.length = 0;

      if (key in cache) {
        return cache[key];
      }

      const result = func(a, b, c);
      cache[key] = result;
      if (order.push(key) > limit) {
        delete cache[order.shift()];
      }
      return result;
    };

  case 4:
    return function memoize_four_args(a, b, c, d) {
      args[0] = a; args[1] = b; args[2] = c; args[3] = d;
      const key = JSON.stringify(args);
      args.length = 0;

      if (key in cache) {
        return cache[key];
      }

      const result = func(a, b, c, d);
      cache[key] = result;
      if (order.push(key) > limit) {
        delete cache[order.shift()];
      }
      return result;
    };

  default:
    return function(...args) {
      const key = JSON.stringify(args);

      if (key in cache) {
        return cache[key];
      }

      const result = func(...args);
      cache[key] = result;
      if (order.push(key) > limit) {
        delete cache[order.shift()];
      }
      return result;
    };
  }
}

module.exports = { memoize };
