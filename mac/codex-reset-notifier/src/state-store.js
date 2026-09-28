const fs = require("fs/promises");
const path = require("path");

const STATE_VERSION = 1;

function createDefaultState() {
  return {
    version: STATE_VERSION,
    initialized: false,
    seenEventIds: [],
    lastSuccessfulCheckAt: null,
    latestResetAt: null,
    settings: { openAtLogin: true, startupConfigured: false }
  };
}

function normalizeTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function normalizeState(value) {
  if (!value || value.version !== STATE_VERSION || !Array.isArray(value.seenEventIds)) {
    return createDefaultState();
  }

  return {
    version: STATE_VERSION,
    initialized: value.initialized === true,
    seenEventIds: [...new Set(value.seenEventIds.filter(id => typeof id === "string" && id))],
    lastSuccessfulCheckAt: typeof value.lastSuccessfulCheckAt === "string"
      ? value.lastSuccessfulCheckAt
      : null,
    latestResetAt: normalizeTimestamp(value.latestResetAt),
    settings: {
      openAtLogin: value.settings?.openAtLogin !== false,
      startupConfigured: value.settings?.startupConfigured === true
    }
  };
}

class StateStore {
  constructor(filePath, fileSystem = fs) {
    this.filePath = filePath;
    this.fileSystem = fileSystem;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    try {
      const raw = await this.fileSystem.readFile(this.filePath, "utf8");
      return normalizeState(JSON.parse(raw));
    } catch {
      return createDefaultState();
    }
  }

  save(state) {
    const normalized = normalizeState(state);
    const operation = this.writeQueue.then(async () => {
      await this.fileSystem.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await this.fileSystem.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      await this.fileSystem.rename(temporaryPath, this.filePath);
      return normalized;
    });

    this.writeQueue = operation.catch(() => {});
    return operation;
  }
}

module.exports = { StateStore, createDefaultState, normalizeState, normalizeTimestamp };
