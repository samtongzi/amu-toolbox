const assert = require("node:assert/strict");
const test = require("node:test");
const { HOME_URL, RESET_EVENT_TYPES } = require("../src/config");
const { getEventTime, getSafeSourceUrl, hasValidId, isResetEvent } = require("../src/event-filter");

test("accepts every configured Codex reset category", () => {
  for (const eventType of RESET_EVENT_TYPES) {
    assert.equal(isResetEvent({ id: "event-1", tool: "codex", eventType }), true);
  }
});

test("rejects feature announcements, unknown categories, and other tools", () => {
  assert.equal(isResetEvent({ id: "1", tool: "codex", eventType: "重置次数功能发布" }), false);
  assert.equal(isResetEvent({ id: "2", tool: "codex", eventType: "新类别" }), false);
  assert.equal(isResetEvent({ id: "3", tool: "claude-code", eventType: "额度重置" }), false);
});

test("requires a non-empty string id", () => {
  assert.equal(hasValidId({ id: "valid" }), true);
  assert.equal(hasValidId({ id: "   " }), false);
  assert.equal(hasValidId({ id: 42 }), false);
  assert.equal(hasValidId(null), false);
});

test("uses a valid sort time and falls back to eventTimeUtc", () => {
  assert.equal(
    getEventTime({ sortTime: "2026-08-03T01:00:00Z", eventTimeUtc: "2026-08-03T02:00:00Z" }),
    Date.parse("2026-08-03T01:00:00Z")
  );
  assert.equal(
    getEventTime({ sortTime: "invalid", eventTimeUtc: "2026-08-03T02:00:00Z" }),
    Date.parse("2026-08-03T02:00:00Z")
  );
  assert.equal(getEventTime({ sortTime: "invalid", eventTimeUtc: "also-invalid" }), 0);
});

test("only opens HTTPS sources", () => {
  assert.equal(getSafeSourceUrl({ sourceUrl: "https://example.com/post" }), "https://example.com/post");
  assert.equal(getSafeSourceUrl({ sourceUrl: "http://example.com" }), HOME_URL);
  assert.equal(getSafeSourceUrl({ sourceUrl: "javascript:alert(1)" }), HOME_URL);
  assert.equal(getSafeSourceUrl({}), HOME_URL);
});
