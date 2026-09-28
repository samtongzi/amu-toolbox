const test = require("node:test");
const assert = require("node:assert/strict");
const { ScanService } = require("../src/services/scan-service");
const { UpdateService } = require("../src/services/update-service");

function createPackages(count = 6) {
  return Array.from({ length: count }, (_, index) => ({
    name: `App ${index + 1}`,
    id: `Vendor.App${index + 1}`,
    installedVersion: "1",
    availableVersion: "2",
    source: "winget",
    installedVersionUnknown: false
  }));
}

function waitFor(service, status) {
  if (service.getState().status === status) return Promise.resolve();
  return new Promise(resolve => {
    const listener = state => {
      if (state.status === status) {
        service.off("changed", listener);
        resolve();
      }
    };
    service.on("changed", listener);
  });
}

async function runScenario({ command = { ok: true, code: "command-completed" }, results }) {
  const packages = createPackages(1);
  let updates = 0;
  let scans = 0;
  const delays = [];
  const client = {
    scan: async () => {
      if (scans++ === 0) return { status: "ready", code: "ok", packages, warnings: [] };
      const result = results[Math.min(scans - 2, results.length - 1)];
      if (result instanceof Error) throw result;
      return { code: "ok", packages: [], warnings: [], ...result };
    },
    update: async () => { updates += 1; return command; }
  };
  const scanService = new ScanService({ client });
  const snapshot = (await scanService.scan()).snapshot;
  const service = new UpdateService({ client, scanService, wait: async ms => { delays.push(ms); } });
  const transitions = [];
  service.on("changed", state => transitions.push(state.items[0].status));
  await service.start({ snapshotId: snapshot.snapshotId, packageKeys: [snapshot.packages[0].packageKey] });
  await waitFor(service, "completed");
  assert.equal(updates, 1, "verification must never repeat installation");
  return { service, scanService, client, delays, transitions, scans };
}

test("a scan error retaining the pre-update snapshot is not an update failure", async () => {
  const { service, delays, transitions } = await runScenario({ results: [{ status: "error" }] });
  assert.equal(service.getState().items[0].status, "unverified");
  assert.deepEqual(delays, [2000, 5000]);
  assert.equal(transitions.includes("failed"), false);
});

test("scan exceptions leave a completed task pending confirmation", async () => {
  const { service } = await runScenario({ results: [new Error("offline")] });
  assert.equal(service.getState().status, "completed");
  assert.equal(service.getState().items[0].status, "unverified");
});

test("allows installer metadata to catch up before reporting the result", async () => {
  const { service, scans, transitions } = await runScenario({ results: [
    { status: "ready", packages: createPackages(1) }, { status: "ready" }
  ] });
  assert.equal(scans, 3);
  assert.equal(service.getState().items[0].status, "succeeded");
  assert.equal(transitions.includes("not-updated"), false);
});

test("nonzero command results are corrected by successful verification", async () => {
  const { service, transitions } = await runScenario({ command: { ok: false, code: "update-failed", diagnostic: "installer exit error" }, results: [{ status: "ready" }] });
  const item = service.getState().items[0];
  assert.equal(item.status, "succeeded");
  assert.equal(item.commandResult.code, "update-failed");
  assert.equal(transitions.includes("failed"), false);
  assert.doesNotMatch(item.diagnostic, /installer exit error/);
});

test("success with an unchanged or unknown version remains unverified", async () => {
  for (const installedVersion of ["1", "Unknown"]) {
    const { service } = await runScenario({ results: [{ status: "ready", packages: [{ ...createPackages(1)[0], installedVersion }] }] });
    assert.equal(service.getState().items[0].status, "unverified");
  }
});

test("partial scans cannot confirm an absent package was updated", async () => {
  const { service } = await runScenario({ results: [{ status: "partial" }] });
  assert.equal(service.getState().items[0].status, "unverified");
});

test("unknown scan results cannot turn an abnormal exit into a confirmed failure", async () => {
  const { service } = await runScenario({ command: { ok: false, code: "update-timeout" }, results: [{ status: "error" }] });
  assert.equal(service.getState().items[0].status, "unverified");
});

test("cancellation interrupts verification delay and preserves completed command results", async () => {
  const packages = createPackages(1);
  const client = {
    scan: async () => ({ status: "ready", code: "ok", packages, warnings: [] }),
    update: async () => ({ ok: true, code: "command-completed" })
  };
  const scanService = new ScanService({ client });
  const snapshot = (await scanService.scan()).snapshot;
  let enterWait;
  const waiting = new Promise(resolve => { enterWait = resolve; });
  const service = new UpdateService({ client, scanService, wait: (ms, signal) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    enterWait();
  }) });
  const run = await service.start({ snapshotId: snapshot.snapshotId, packageKeys: [snapshot.packages[0].packageKey] });
  await waiting;
  assert.equal(service.cancel(run.runId), true);
  await waitFor(service, "cancelled");
  assert.equal(service.getState().items[0].status, "unverified");
  assert.equal(service.getState().completed, 1);
});

test("reaching the original target counts as success even with another update listed", async () => {
  const { service } = await runScenario({ results: [{ status: "ready", packages: [{ ...createPackages(1)[0], installedVersion: "2.0", availableVersion: "3" }] }] });
  assert.equal(service.getState().items[0].status, "succeeded");
});

test("manual refresh corrects both pending and failed results without reinstalling", async () => {
  for (const ok of [true, false]) {
    const { service, scanService, client } = await runScenario({ command: { ok, code: ok ? "command-completed" : "update-failed" }, results: [{ status: "ready", packages: createPackages(1) }] });
    assert.equal(service.getState().items[0].status, ok ? "unverified" : "failed");
    client.scan = async () => ({ status: "ready", code: "ok", packages: [], warnings: [] });
    await scanService.scan({ reason: "manual" });
    assert.equal(service.getState().items[0].status, "succeeded");
    assert.throws(() => service.retryFailed(service.getState().runId), error => error.code === "retry-unavailable");
  }
});

for (const concurrency of [1, 2, 5]) {
  test(`limits concurrent updates to ${concurrency}`, async () => {
    let packages = createPackages();
    let active = 0;
    let maxActive = 0;
    let scans = 0;
    const calls = [];
    const client = {
      scan: async () => {
        scans += 1;
        return { status: "ready", code: "ok", packages, warnings: [] };
      },
      update: async pkg => {
        calls.push(pkg.id);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 8));
        packages = packages.filter(item => item.id !== pkg.id);
        active -= 1;
        return { ok: true, code: "command-completed" };
      }
    };
    const scanService = new ScanService({ client });
    const snapshot = (await scanService.scan()).snapshot;
    const service = new UpdateService({ client, scanService, getConcurrency: () => concurrency });
    await service.start({ snapshotId: snapshot.snapshotId, packageKeys: snapshot.packages.map(pkg => pkg.packageKey) });
    await waitFor(service, "completed");
    const state = service.getState();
    assert.equal(maxActive, concurrency);
    assert.equal(new Set(calls).size, 6);
    assert.equal(scans, 2);
    assert.equal(state.concurrency, concurrency);
    assert.deepEqual(state.items.map(item => item.status), Array(6).fill("succeeded"));
  });
}

test("isolates real failures and retries verification without reinstalling", async () => {
  let packages = createPackages();
  let scans = 0;
  const client = {
    scan: async () => {
      scans += 1;
      return { status: "ready", code: "ok", packages, warnings: [] };
    },
    update: async pkg => {
      await new Promise(resolve => setTimeout(resolve, 3));
      if (pkg.id === "Vendor.App2") return { ok: false, code: "failed", diagnostic: "mock failure" };
      packages = packages.filter(item => item.id !== pkg.id);
      return { ok: true, code: "command-completed" };
    }
  };
  const scanService = new ScanService({ client });
  const snapshot = (await scanService.scan()).snapshot;
  const service = new UpdateService({ client, scanService, getConcurrency: () => 5, wait: async () => {} });
  await service.start({ snapshotId: snapshot.snapshotId, packageKeys: snapshot.packages.map(pkg => pkg.packageKey) });
  await waitFor(service, "completed");
  const states = service.getState().items.map(item => item.status);
  assert.equal(states.filter(status => status === "failed").length, 1);
  assert.equal(states.filter(status => status === "succeeded").length, 5);
  assert.equal(scans, 4);
});

test("cancels active workers and never starts queued packages", async () => {
  const packages = createPackages();
  const started = [];
  let scanCount = 0;
  const client = {
    scan: async () => {
      scanCount += 1;
      return { status: "ready", code: "ok", packages, warnings: [] };
    },
    update: (pkg, { signal }) => new Promise(resolve => {
      started.push(pkg.id);
      signal.addEventListener("abort", () => resolve({ ok: false, code: "update-cancelled" }), { once: true });
    })
  };
  const scanService = new ScanService({ client });
  const snapshot = (await scanService.scan()).snapshot;
  const service = new UpdateService({ client, scanService, getConcurrency: () => 2 });
  const run = await service.start({ snapshotId: snapshot.snapshotId, packageKeys: snapshot.packages.map(pkg => pkg.packageKey) });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(service.cancel(run.runId), true);
  await waitFor(service, "cancelled");
  const state = service.getState();
  assert.equal(started.length, 2);
  assert.equal(state.completed, 6);
  assert.equal(state.items.every(item => item.status === "cancelled"), true);
  assert.equal(scanCount, 2);
});

test("filters ignored packages before starting", async () => {
  let packages = createPackages(2);
  const calls = [];
  const client = {
    scan: async () => ({ status: "ready", code: "ok", packages, warnings: [] }),
    update: async pkg => {
      calls.push(pkg.id);
      packages = packages.filter(item => item.id !== pkg.id);
      return { ok: true, code: "command-completed" };
    }
  };
  const scanService = new ScanService({ client });
  const snapshot = (await scanService.scan()).snapshot;
  const service = new UpdateService({ client, scanService, isIgnoredPackage: pkg => pkg.id === "Vendor.App2" });
  await service.start({ snapshotId: snapshot.snapshotId, packageKeys: snapshot.packages.map(pkg => pkg.packageKey) });
  await waitFor(service, "completed");
  assert.deepEqual(calls, ["Vendor.App1"]);
  assert.equal(service.getState().total, 1);

  const ignoredService = new UpdateService({ client, scanService, isIgnoredPackage: () => true });
  await assert.rejects(
    ignoredService.start({ snapshotId: scanService.getSnapshot().snapshotId, packageKeys: [scanService.getSnapshot().packages[0].packageKey] }),
    error => error.code === "no-updatable-selection"
  );
});
