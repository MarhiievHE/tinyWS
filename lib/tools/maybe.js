'use strict';

class Maybe {
  #value;

  constructor(value) {
    this.#value = value;
  }

  get value() {
    return this.#value;
  }

  isEmpty() {
    return this.#value === undefined || this.#value === null;
  }

  match(someFn, noneFn) {
    return this.isEmpty() ? noneFn() : someFn(this.#value);
  }
}

module.exports = {
  Maybe,
};
