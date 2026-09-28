const test = require("node:test");
const assert = require("node:assert/strict");
const { createDefaultState, normalizeState } = require("../src/state-store");

 test("falls back when state version is invalid", () => {
  assert.deepEqual(normalizeState({ version: 99 }), createDefaultState());
});

test("migrates version 1 settings and notification keys", () => {
  const state = normalizeState({
    version: 1,
    initialized: true,
    knownUpdateKeys: ["winget:Vendor.One", "winget:Vendor.One", 2],
    lastSuccessfulScanAt: "2026-01-01T00:00:00Z",
    settings: { notificationsEnabled: false, openAtLogin: true, scanIntervalMinutes: 30 }
  });
  assert.equal(state.version, 2);
  assert.deepEqual(state.knownUpdateKeys, ["winget\0vendor.one"]);
  assert.equal(state.settings.scanIntervalMinutes, 30);
  assert.equal(state.settings.maxConcurrentUpdates, 5);
});

test("normalizes concurrency and ignored packages", () => {
  const state = normalizeState({
    version: 2,
    settings: { maxConcurrentUpdates: 3 },
    ignoredPackages: [
      { source: " Winget ", id: "Vendor.One", name: "One", ignoredAt: "2026-01-01T00:00:00Z" },
      { source: "winget", id: "vendor.one", name: "Duplicate" },
      { source: "", id: "bad" }
    ]
  });
  assert.equal(state.settings.maxConcurrentUpdates, 3);
  assert.equal(state.ignoredPackages.length, 1);
  assert.equal(state.ignoredPackages[0].identity, "winget\0vendor.one");
  assert.equal(normalizeState({ version: 2, settings: { maxConcurrentUpdates: 7 } }).settings.maxConcurrentUpdates, 5);
});
