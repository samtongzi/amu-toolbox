const assert = require("node:assert/strict");
const test = require("node:test");
const { ApiClient } = require("../src/api-client");

function response(body, { status = 200, headers = {} } = {}) {
  const bytes = Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    arrayBuffer: async () => bytes
  };
}

function clientWith(fetcher, overrides = {}) {
  return new ApiClient({
    fetcher,
    url: "https://example.test/events",
    timeoutMs: 100,
    maxResponseBytes: 1024,
    ...overrides
  });
}

test("returns a JSON array and adds a cache buster", async () => {
  let requestedUrl;
  const client = clientWith(async (url, options) => {
    requestedUrl = url;
    assert.equal(options.cache, "no-store");
    return response('[{"id":"1"}]');
  });

  assert.deepEqual(await client.fetchEvents(), [{ id: "1" }]);
  assert.match(requestedUrl, /\?t=\d+$/);
});

test("rejects HTTP errors, invalid JSON, and non-array payloads", async () => {
  await assert.rejects(clientWith(async () => response("no", { status: 503 })).fetchEvents(), /HTTP 503/);
  await assert.rejects(clientWith(async () => response("not json")).fetchEvents(), /无效 JSON/);
  await assert.rejects(clientWith(async () => response("{}")) .fetchEvents(), /格式不正确/);
});

test("rejects oversized payloads from header, stream, or body", async () => {
  const byHeader = clientWith(async () => response("[]", { headers: { "content-length": "2048" } }));
  await assert.rejects(byHeader.fetchEvents(), /响应过大/);

  let cancelled = false;
  const byStream = clientWith(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => {
        let readCount = 0;
        return {
          read: async () => readCount++ === 0
            ? { done: false, value: Buffer.alloc(2048) }
            : { done: true },
          cancel: async () => { cancelled = true; },
          releaseLock() {}
        };
      }
    }
  }));
  await assert.rejects(byStream.fetchEvents(), /响应过大/);
  assert.equal(cancelled, true);

  const byBody = clientWith(async () => response(JSON.stringify(["x".repeat(2048)])));
  await assert.rejects(byBody.fetchEvents(), /响应过大/);
});

test("aborts a stalled request", async () => {
  const client = clientWith((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")));
  }), { timeoutMs: 5 });
  await assert.rejects(client.fetchEvents(), /aborted/);
});
