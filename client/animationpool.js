"use strict";

const RUN = Symbol();

/**
 * Our fine little animation pool: pooling requestAnimationFrame calls.
 * @class
 */
class AnimationPool {
  constructor() {
    this.items = [];
    this.promise = null;
    this.resolve = null;
    this[RUN] = this[RUN].bind(this);
    Object.seal(this);
  }

  [RUN]() {
    try {
      while (this.items.length) {
        const items = Array.from(this.items);
        this.items.length = 0;
        for (const item of items) {
          item.fn.call(item.ctx, ...item.args);
        }
      }
    }
    finally {
      const {resolve} = this;
      this.items.length = 0;
      this.promise = null;
      this.resolve = null;
      resolve();
    }
  }

  /**
   * Schedule a call once.
   *
   * @param {Object} ctx
   *   Your this to your function.
   * @param {function} fn
   *   The function to execute within an animation frame.
   * @param {*} args
   *   Any args you want to pass to your function
   *
   * @returns {Promise}
   *   Animation Frame Request resolution
   */
  schedule(ctx, fn, ...args) {
    this.items.push({ ctx, fn, args });
    if (!this.promise) {
      this.promise = new Promise(resolve => {
        this.resolve = resolve;
      });
      requestAnimationFrame(this[RUN]);
    }
    return this.promise;
  }

  /**
   * Bind a function to a context (this) and some arguments.
   * The bound function will then always execute within an animation frame and
   * is therefore called asynchronous and does only return a request ID.
   *
   * @param {Object} ctx
   *   Your this to your function.
   * @param {function} fn
   *   The function to execute within an animation frame:
   * @param {*} args
   *   Any args you want to pass to your function, it's possible to call the
   *   wrapped function with additional arguments.
   *
   * @returns {function}
   *   Your newly bound function.
   *
   * @see AnimationPool.schedule
   */
  bind(ctx, fn, ...args) {
    return this.schedule.bind(this, ctx, fn, ...args);
  }

  /**
   * Wrap a function.
   * The bound function will then always execute within an animation frame and
   * is therefore called asynchronous and does not return a value.
   * |this| within your function will not be modified.
   *
   * @param {function} fn
   *   The function to execute within an animation frame.
   *
   * @returns {function(*)}
   *   Your newly bound function.
   */
  wrap(fn) {
    const self = this;
    return function wrapped(...args) {
      return self.schedule(this, fn, ...args);
    };
  }
}

const APOOL = new AnimationPool();

export { AnimationPool, APOOL };
