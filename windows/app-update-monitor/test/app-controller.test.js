const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { AppController } = require("../src/services/app-controller");

class QuietService extends EventEmitter {
  getState() { return { status: "idle", items: [] }; }
}

test("filters ignored packages from the public snapshot", () => {
  const packages = [
    { packageKey: "one", name: "One", source: "winget", id: "Vendor.One" },
    { packageKey: "two", name: "Two", source: "winget", id: "Vendor.Two" }
  ];
  const updateService = new QuietService();
  const logService = new EventEmitter();
  logService.list = () => [];
  const monitor = {
    getState: () => ({ settings: {}, ignoredPackages: [{ identity: "winget\0vendor.one" }] }),
    filterIgnoredPackages: values => values.filter(pkg => pkg.id !== "Vendor.One")
  };
  const controller = new AppController({
    scanService: { getSnapshot: () => ({ snapshotId: "snapshot", createdAt: "now", status: "ready", warnings: [], packages }) },
    updateService,
    monitor,
    logService,
    winget: { available: true, version: "mock" }
  });
  const state = controller.getPublicState();
  assert.deepEqual(state.snapshot.packages.map(pkg => pkg.id), ["Vendor.Two"]);
  assert.equal(state.persisted.ignoredPackages.length, 1);
});
