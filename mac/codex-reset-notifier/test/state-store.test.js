const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { StateStore, createDefaultState, normalizeState } = require("../src/state-store");

test("normalizes missing and incompatible state to safe defaults", () => {
  assert.deepEqual(normalizeState(null), createDefaultState());
  assert.deepEqual(normalizeState({ version: 999, seenEventIds: [] }), createDefaultState());
  assert.equal(createDefaultState().settings.openAtLogin, true);
  assert.equal(createDefaultState().latestResetAt, null);
});

test("normalizes ids and settings", () => {
  const state = normalizeState({
    version: 1,
    initialized: true,
    seenEventIds: ["a", "a", "", 4],
    lastSuccessfulCheckAt: "2026-08-03T00:00:00.000Z",
    settings: { openAtLogin: false }
  });
  assert.deepEqual(state.seenEventIds, ["a"]);
  assert.equal(state.settings.openAtLogin, false);
  assert.equal(state.latestResetAt, null);

  const withResetTime = normalizeState({
    version: 1,
    initialized: true,
    seenEventIds: [],
    latestResetAt: "2026-08-01T03:32:37Z"
  });
  assert.equal(withResetTime.latestResetAt, "2026-08-01T03:32:37.000Z");
});

test("persists and reloads state", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-notifier-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "state.json");
  const store = new StateStore(filePath);
  await store.save({
    ...createDefaultState(),
    initialized: true,
    seenEventIds: ["one"],
    lastSuccessfulCheckAt: "2026-08-03T00:00:00.000Z"
  });
  await store.save({
    ...createDefaultState(),
    initialized: true,
    seenEventIds: ["one", "two"],
    lastSuccessfulCheckAt: "2026-08-03T00:05:00.000Z",
    latestResetAt: "2026-08-01T03:32:37Z"
  });
  const loaded = await store.load();
  assert.deepEqual(loaded.seenEventIds, ["one", "two"]);
  assert.equal(loaded.latestResetAt, "2026-08-01T03:32:37.000Z");
});

test("corrupt state silently returns a fresh baseline", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-notifier-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "state.json");
  await fs.writeFile(filePath, "not-json");
  assert.deepEqual(await new StateStore(filePath).load(), createDefaultState());
});
