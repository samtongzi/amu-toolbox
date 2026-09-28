const test = require("node:test");
const assert = require("node:assert/strict");
const { Monitor } = require("../src/services/monitor");
const { createDefaultState, normalizeState } = require("../src/state-store");

function createMonitor({ notifications = [] } = {}) {
  let stored = createDefaultState();
  const stateStore = {
    load: async () => stored,
    save: async state => {
      await new Promise(resolve => setTimeout(resolve, 1));
      stored = normalizeState(state);
      return stored;
    }
  };
  const scanService = {
    scan: async () => ({ status: "ready", snapshot: { packages: [] } })
  };
  const monitor = new Monitor({
    scanService,
    stateStore,
    notifier: { notify: payload => notifications.push(payload) },
    intervalMs: 60_000,
    setTimer: () => null,
    clearTimer: () => {}
  });
  return { monitor, getStored: () => stored };
}

test("serializes ignore and restore mutations", async () => {
  const { monitor, getStored } = createMonitor();
  await monitor.start();
  const one = { name: "One", source: "winget", id: "Vendor.One" };
  const two = { name: "Two", source: "winget", id: "Vendor.Two" };
  await Promise.all([monitor.ignorePackage(one), monitor.ignorePackage(two)]);
  assert.deepEqual(getStored().ignoredPackages.map(item => item.id).sort(), ["Vendor.One", "Vendor.Two"]);
  assert.equal(monitor.isPackageIgnored(one), true);
  await monitor.restoreIgnored("winget\0vendor.one");
  assert.equal(monitor.isPackageIgnored(one), false);
  assert.equal(monitor.isPackageIgnored(two), true);
});

test("filters ignored packages from notifications but keeps the baseline", async () => {
  const notifications = [];
  const { monitor, getStored } = createMonitor({ notifications });
  await monitor.start();
  await monitor.ignorePackage({ name: "One", source: "winget", id: "Vendor.One" });
  await monitor.updateNotificationBaseline({
    packages: [
      { source: "winget", id: "Vendor.One" },
      { source: "winget", id: "Vendor.Two" }
    ]
  });
  await monitor.updateNotificationBaseline({
    packages: [
      { source: "winget", id: "Vendor.One" },
      { source: "winget", id: "Vendor.Two" },
      { source: "winget", id: "Vendor.Three" }
    ]
  });
  assert.deepEqual(notifications.map(item => item.body), ["winget\0vendor.two", "winget\0vendor.three"]);
  assert.deepEqual(getStored().knownUpdateKeys.sort(), ["winget\0vendor.one", "winget\0vendor.three", "winget\0vendor.two"]);
});

test("forwards scan diagnostics to the UI and clears previous errors on recovery", async () => {
  const { monitor } = createMonitor();
  const patches = [];
  monitor.onState = patch => patches.push(patch);
  monitor.scanService.scan = async () => ({ status: "error", code: "source-error", diagnostic: "打开源失败：network unavailable", packages: [] });
  await monitor.start();
  assert.equal(patches.at(-1).scanStatus, "error");
  assert.match(patches.at(-1).error, /network unavailable/);
  monitor.scanService.scan = async () => ({ status: "ready", code: "no-updates", snapshot: { packages: [] } });
  await monitor.check();
  assert.equal(patches.at(-1).scanStatus, "ready");
  assert.equal(patches.at(-1).error, null);
});
