const assert = require("node:assert/strict");
const test = require("node:test");
const { Monitor } = require("../src/monitor");
const { createDefaultState } = require("../src/state-store");

function resetEvent(id, sortTime = "2026-08-03T00:00:00Z") {
  return { id, tool: "codex", eventType: "额度重置", title: id, sortTime };
}

function harness(initialState = createDefaultState()) {
  let state = structuredClone(initialState);
  const feeds = [];
  const notifications = [];
  const statuses = [];
  let saveError = null;
  const apiClient = { fetchEvents: async () => feeds.shift() ?? [] };
  const stateStore = {
    load: async () => structuredClone(state),
    save: async next => {
      if (saveError) throw saveError;
      state = structuredClone(next);
      return structuredClone(state);
    }
  };
  const monitor = new Monitor({
    apiClient,
    stateStore,
    notifier: { notify: event => notifications.push(event.id) },
    intervalMs: 300000,
    onStatus: status => statuses.push(status),
    setTimer: () => 1,
    clearTimer: () => {}
  });
  return {
    monitor, feeds, notifications, statuses,
    getState: () => state,
    failSaves: error => { saveError = error; }
  };
}

test("first successful fetch creates a silent baseline", async () => {
  const h = harness();
  h.feeds.push([resetEvent("historical")]);
  await h.monitor.start();
  assert.deepEqual(h.notifications, []);
  assert.deepEqual(h.getState().seenEventIds, ["historical"]);
  assert.equal(h.getState().initialized, true);
  assert.equal(h.getState().latestResetAt, "2026-08-03T00:00:00.000Z");
  assert.equal(h.statuses.at(-1).latestResetAt, "2026-08-03T00:00:00.000Z");
  h.monitor.stop();
});

test("notifies only unseen allowed events and persists all new ids", async () => {
  const h = harness({ ...createDefaultState(), initialized: true, seenEventIds: ["old"] });
  h.feeds.push([
    resetEvent("old"),
    { id: "feature", tool: "codex", eventType: "重置次数功能发布" },
    { id: "claude", tool: "claude-code", eventType: "额度重置" },
    resetEvent("new")
  ]);
  await h.monitor.start();
  assert.deepEqual(h.notifications, ["new"]);
  assert.deepEqual(new Set(h.getState().seenEventIds), new Set(["old", "feature", "claude", "new"]));
  assert.equal(h.getState().latestResetAt, "2026-08-03T00:00:00.000Z");
  h.monitor.stop();
});

test("deduplicates a response and orders multiple alerts oldest to newest", async () => {
  const h = harness({ ...createDefaultState(), initialized: true });
  h.feeds.push([
    resetEvent("newer", "2026-08-03T02:00:00Z"),
    resetEvent("older", "2026-08-03T01:00:00Z"),
    resetEvent("newer", "2026-08-03T02:00:00Z")
  ]);
  await h.monitor.start();
  assert.deepEqual(h.notifications, ["older", "newer"]);
  h.monitor.stop();
});

test("keeps the latest reset time when a later response is empty or older", async () => {
  const h = harness({
    ...createDefaultState(),
    initialized: true,
    latestResetAt: "2026-08-03T02:00:00.000Z"
  });
  h.feeds.push([resetEvent("older", "2026-08-03T01:00:00Z")]);
  await h.monitor.start();
  assert.equal(h.getState().latestResetAt, "2026-08-03T02:00:00.000Z");
  h.feeds.push([]);
  await h.monitor.check();
  assert.equal(h.getState().latestResetAt, "2026-08-03T02:00:00.000Z");
  assert.equal(h.statuses.at(-1).latestResetAt, "2026-08-03T02:00:00.000Z");
  h.monitor.stop();
});

test("invalid sortTime can use eventTimeUtc for the latest reset", async () => {
  const h = harness();
  h.feeds.push([{
    ...resetEvent("fallback", "invalid"),
    eventTimeUtc: "2026-08-03T04:00:00Z"
  }]);
  await h.monitor.start();
  assert.equal(h.getState().latestResetAt, "2026-08-03T04:00:00.000Z");
  h.monitor.stop();
});

test("same id never notifies again after reorder or mutation", async () => {
  const h = harness({ ...createDefaultState(), initialized: true, seenEventIds: ["same"] });
  h.feeds.push([{ ...resetEvent("same"), title: "changed" }]);
  await h.monitor.start();
  assert.deepEqual(h.notifications, []);
  h.monitor.stop();
});

test("does not notify if state persistence fails", async () => {
  const h = harness({ ...createDefaultState(), initialized: true });
  h.feeds.push([resetEvent("new")]);
  h.failSaves(new Error("disk full"));
  const result = await h.monitor.start();
  assert.deepEqual(h.notifications, []);
  assert.equal(h.statuses.at(-1).state, "error");
  h.monitor.stop();
  assert.equal(result, undefined);
});

test("startup setting changes preserve ids discovered by a concurrent check", async () => {
  const h = harness({ ...createDefaultState(), initialized: true, seenEventIds: ["old"] });
  h.feeds.push([resetEvent("new")]);
  await Promise.all([h.monitor.check(), h.monitor.setOpenAtLogin(false)]);
  assert.deepEqual(new Set(h.getState().seenEventIds), new Set(["old", "new"]));
  assert.equal(h.getState().settings.openAtLogin, false);
  assert.equal(h.notifications[0], "new");
  h.monitor.stop();
});

test("concurrent checks share one request", async () => {
  let resolveFetch;
  let calls = 0;
  const monitor = new Monitor({
    apiClient: { fetchEvents: () => { calls += 1; return new Promise(resolve => { resolveFetch = resolve; }); } },
    stateStore: { load: async () => ({ ...createDefaultState(), initialized: true }), save: async state => state },
    notifier: { notify() {} },
    intervalMs: 300000,
    setTimer: () => 1,
    clearTimer: () => {}
  });
  monitor.state = { ...createDefaultState(), initialized: true };
  monitor.stopped = false;
  const first = monitor.check();
  const second = monitor.check();
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolveFetch([]);
  await first;
  monitor.stop();
});
