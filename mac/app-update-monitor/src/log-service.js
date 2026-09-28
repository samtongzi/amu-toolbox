const { EventEmitter } = require("events");
const { randomUUID } = require("crypto");
const { MAX_LOG_ENTRIES } = require("./config");

class LogService extends EventEmitter {
  constructor({ maxEntries = MAX_LOG_ENTRIES } = {}) {
    super();
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  add(level, scope, code, message, packageKey) {
    const entry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      scope,
      code,
      message: String(message || "").slice(0, 1_000),
      ...(packageKey ? { packageKey } : {})
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    this.emit("entry", entry);
    return entry;
  }

  clear() {
    this.entries = [];
  }

  list() {
    return this.entries.map(entry => ({ ...entry }));
  }
}

module.exports = { LogService };
