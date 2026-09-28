const test = require("node:test");
const assert = require("node:assert/strict");
const { IpcController, assertExactKeys, assertKeyList, validateSettings } = require("../src/controllers/ipc-controller");

 test("accepts only exact IPC fields", () => {
  assert.doesNotThrow(() => assertExactKeys({ runId: "a" }, ["runId"]));
  assert.throws(() => assertExactKeys({ runId: "a", command: "evil" }, ["runId"]));
});

test("rejects duplicate keys", () => {
  assert.throws(() => assertKeyList(["a", "a"]));
});

test("validates settings bounds and types", () => {
  assert.doesNotThrow(() => validateSettings({ scanIntervalMinutes: 60, notificationsEnabled: true, maxConcurrentUpdates: 5 }));
  assert.doesNotThrow(() => validateSettings({ maxConcurrentUpdates: 1 }));
  assert.throws(() => validateSettings({ scanIntervalMinutes: 1 }));
  assert.throws(() => validateSettings({ maxConcurrentUpdates: 6 }));
  assert.throws(() => validateSettings({ maxConcurrentUpdates: 2.5 }));
  assert.throws(() => validateSettings({ openAtLogin: "yes" }));
});

test("resolves package in the main process before showing ignore menu", async () => {
  const handlers = new Map();
  const sender = {};
  let template;
  let popupOptions;
  let resolvedRequest;
  let ignoredPackage;
  let broadcasts = 0;
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: () => {}
  };
  const controller = new IpcController({
    ipcMain,
    windowController: { window: { webContents: sender } },
    appController: { broadcast: () => { broadcasts += 1; }, getPublicState: () => ({}) },
    monitor: {
      check: async () => {},
      isPackageIgnored: () => false,
      ignorePackage: async pkg => { ignoredPackage = pkg; },
      restoreIgnored: async () => {},
      updateSettings: async () => ({ settings: {} })
    },
    updateService: { getState: () => ({ status: "idle" }) },
    logService: { clear: () => {} },
    startupService: { setEnabled: () => true },
    scanService: {
      resolvePackages: (snapshotId, packageKeys) => {
        resolvedRequest = { snapshotId, packageKeys };
        return [{ name: "Trusted", id: "Vendor.Trusted", source: "winget", packageKey: packageKeys[0] }];
      }
    },
    Menu: {
      buildFromTemplate: value => {
        template = value;
        return { popup: options => { popupOptions = options; } };
      }
    }
  });
  controller.register();
  const result = await handlers.get("packages:show-context-menu")(
    { sender },
    { snapshotId: "snapshot", packageKey: "opaque-key" }
  );
  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(resolvedRequest, { snapshotId: "snapshot", packageKeys: ["opaque-key"] });
  assert.equal(template[0].label, "忽略此软件的更新");
  assert.equal(popupOptions.window.webContents, sender);
  await template[0].click();
  assert.equal(ignoredPackage.id, "Vendor.Trusted");
  assert.equal(broadcasts, 1);
});

test("validates restore identity before mutating state", async () => {
  const handlers = new Map();
  const sender = {};
  const restored = [];
  const controller = new IpcController({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: () => {} },
    windowController: { window: { webContents: sender } },
    appController: { broadcast: () => {}, getPublicState: () => ({}) },
    monitor: { restoreIgnored: async identity => restored.push(identity) },
    updateService: {},
    logService: {},
    startupService: {},
    scanService: {},
    Menu: {}
  });
  controller.register();
  await handlers.get("ignored:restore")({ sender }, { identity: "winget\0vendor.one" });
  assert.deepEqual(restored, ["winget\0vendor.one"]);
  await assert.rejects(
    handlers.get("ignored:restore")({ sender }, { identity: "winget:vendor.one" }),
    error => error.code === "invalid-package-identity"
  );
});
