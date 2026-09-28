const fs = require("fs/promises");
const path = require("path");
const {
  DEFAULT_MAX_CONCURRENT_UPDATES,
  DEFAULT_SCAN_INTERVAL_MINUTES,
  MAX_CONCURRENT_UPDATES,
  MAX_SCAN_INTERVAL_MINUTES,
  MIN_CONCURRENT_UPDATES,
  MIN_SCAN_INTERVAL_MINUTES
} = require("./config");
const { getPackageIdentity, normalizeStoredIdentity } = require("./package-identity");

const STATE_VERSION = 2;

function createDefaultState() {
  return {
    version: STATE_VERSION,
    initialized: false,
    lastSuccessfulScanAt: null,
    knownUpdateKeys: [],
    notifiedUpdates: [],
    settings: {
      notificationsEnabled: true,
      openAtLogin: false,
      scanIntervalMinutes: DEFAULT_SCAN_INTERVAL_MINUTES,
      maxConcurrentUpdates: DEFAULT_MAX_CONCURRENT_UPDATES
    },
    ignoredPackages: []
  };
}

function normalizeState(value) {
  const fallback = createDefaultState();
  if (!value || ![1, STATE_VERSION].includes(value.version)) return fallback;
  const interval = Number(value.settings?.scanIntervalMinutes);
  const concurrency = Number(value.settings?.maxConcurrentUpdates);
  return {
    version: STATE_VERSION,
    initialized: value.initialized === true,
    lastSuccessfulScanAt: validDate(value.lastSuccessfulScanAt),
    knownUpdateKeys: normalizeKnownKeys(value.knownUpdateKeys),
    notifiedUpdates: Array.isArray(value.notifiedUpdates) ? normalizeNotifiedUpdates(value.notifiedUpdates) : null,
    settings: {
      notificationsEnabled: value.settings?.notificationsEnabled !== false,
      openAtLogin: value.settings?.openAtLogin === true,
      scanIntervalMinutes: Number.isInteger(interval) && interval >= MIN_SCAN_INTERVAL_MINUTES && interval <= MAX_SCAN_INTERVAL_MINUTES
        ? interval
        : fallback.settings.scanIntervalMinutes,
      maxConcurrentUpdates: Number.isInteger(concurrency) && concurrency >= MIN_CONCURRENT_UPDATES && concurrency <= MAX_CONCURRENT_UPDATES
        ? concurrency
        : fallback.settings.maxConcurrentUpdates
    },
    ignoredPackages: normalizeIgnoredPackages(value.ignoredPackages)
  };
}

function normalizeNotifiedUpdates(value) {
  const records = new Map();
  for (const item of value) {
    const identity = normalizeStoredIdentity(item?.identity);
    const version = typeof item?.version === "string" ? item.version.trim().slice(0, 256) : "";
    if (!identity || !version || version.includes("\0")) continue;
    records.set(JSON.stringify([identity, version]), { identity, version });
  }
  return [...records.values()].slice(-10000);
}

function normalizeKnownKeys(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeStoredIdentity).filter(Boolean))];
}

function normalizeIgnoredPackages(value) {
  if (!Array.isArray(value)) return [];
  const packages = new Map();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const identity = getPackageIdentity(item);
    if (!identity) continue;
    const source = item.source.trim().slice(0, 256);
    const id = item.id.trim().slice(0, 256);
    packages.set(identity, {
      identity,
      source,
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 256) : id,
      ignoredAt: validDate(item.ignoredAt) || new Date(0).toISOString()
    });
  }
  return [...packages.values()];
}

function validDate(value) {
  const timestamp = Date.parse(value || "");
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

class StateStore {
  constructor(filePath, fileSystem = fs) {
    this.filePath = filePath;
    this.fileSystem = fileSystem;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    try {
      return normalizeState(JSON.parse(await this.fileSystem.readFile(this.filePath, "utf8")));
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

module.exports = { StateStore, createDefaultState, normalizeIgnoredPackages, normalizeState };
