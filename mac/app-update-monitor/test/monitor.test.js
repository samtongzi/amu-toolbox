const test = require("node:test");
const assert = require("node:assert/strict");
const { Monitor } = require("../src/services/monitor");
const { createDefaultState, normalizeState } = require("../src/state-store");

function createMonitor({ notifications = [], initialState = createDefaultState() } = {}) {
  let stored = initialState;
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
  assert.deepEqual(notifications.map(item => item.body), ["Vendor.Two", "Vendor.Three"]);
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

test('notifies once per version across source failures, missing rows and restarts', async () => {
  const notifications = [], { monitor, getStored } = createMonitor({ notifications });
  const app = { source: 'sparkle', id: 'com.example.app', name: 'MacWhisper', availableVersion: '15.2.1', availableBuild: '1521' };
  await monitor.start();
  await monitor.updateNotificationBaseline({ packages: [app] });
  await monitor.updateNotificationBaseline({ packages: [] });
  await monitor.updateNotificationBaseline({ packages: [app] });
  assert.deepEqual(notifications.map(x => x.body), ['MacWhisper → 15.2.1']);
  const resumed = createMonitor({ notifications, initialState: getStored() }).monitor;
  await resumed.start();
  await resumed.updateNotificationBaseline({ packages: [app] });
  assert.equal(notifications.length, 1);
  await resumed.updateNotificationBaseline({ packages: [{ ...app, availableBuild: '1522', availableVersion: '15.2.2' }] });
  assert.equal(notifications.at(-1).body, 'MacWhisper → 15.2.2');
});

test('batches simultaneous discoveries into one notification and records disabled notifications', async () => {
  const notifications = [], { monitor } = createMonitor({ notifications });
  await monitor.start();
  const packages = [1, 2, 3, 4].map(i => ({ source: 'sparkle', id: `app.${i}`, name: `App ${i}`, availableVersion: '2' }));
  await monitor.updateNotificationBaseline({ packages });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, '发现 4 款应用更新');
  assert.doesNotMatch(notifications[0].body, /sparkle|\0/);
  await monitor.updateSettings({ notificationsEnabled: false });
  const newer = packages.map(p => ({ ...p, availableVersion: '3' }));
  await monitor.updateNotificationBaseline({ packages: newer });
  await monitor.updateSettings({ notificationsEnabled: true });
  await monitor.updateNotificationBaseline({ packages: newer });
  assert.equal(notifications.length, 1);
});

test('migrates old notification state silently without losing settings or ignored apps', async () => {
  const notifications = [], old = { ...createDefaultState(), initialized: true, settings: { notificationsEnabled: true, scanIntervalMinutes: 30 } };
  delete old.notifiedUpdates;
  const { monitor, getStored } = createMonitor({ notifications, initialState: normalizeState(old) });
  const app = { source: 'sparkle', id: 'existing', name: 'Existing', availableVersion: '2' };
  monitor.scanService.scan = async () => ({ status: 'ready', snapshot: { packages: [app] } });
  await monitor.start();
  await monitor.check();
  assert.equal(notifications.length, 0);
  assert.equal(getStored().notifiedUpdates.length, 1);
  assert.equal(getStored().settings.scanIntervalMinutes, 30);
});

test('legacy baseline survives an empty first scan during migration', async () => {
  const notifications = [], old = { ...createDefaultState(), initialized: true, knownUpdateKeys: ['sparkle\0existing'] };
  delete old.notifiedUpdates;
  const { monitor } = createMonitor({ notifications, initialState: normalizeState(old) });
  await monitor.start();
  const pkg = { source: 'sparkle', id: 'existing', name: 'Existing', availableVersion: '2' };
  await monitor.updateNotificationBaseline({ packages: [pkg] });
  assert.equal(notifications.length, 0);
  await monitor.updateNotificationBaseline({ packages: [{ ...pkg, availableVersion: '3' }] });
  assert.equal(notifications[0].body, 'Existing → 3');
});
