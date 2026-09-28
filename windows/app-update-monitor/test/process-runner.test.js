const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { ProcessRunner } = require("../src/winget/process-runner");

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 42;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test("spawns with an argument array and shell disabled", async () => {
  const child = fakeChild();
  let captured;
  const runner = new ProcessRunner({
    spawnProcess: (file, args, options) => {
      captured = { file, args, options };
      setImmediate(() => child.emit("close", 0, null));
      return child;
    },
    killProcessTree: async () => {}
  });
  const result = await runner.run("winget.exe", ["upgrade", "--id", "Vendor.App"]);
  assert.equal(result.code, 0);
  assert.deepEqual(captured.args, ["upgrade", "--id", "Vendor.App"]);
  assert.equal(captured.options.shell, false);
});

test("cancels a running process through the process tree killer", async () => {
  const child = fakeChild();
  const controller = new AbortController();
  let killedPid;
  const runner = new ProcessRunner({
    spawnProcess: () => child,
    killProcessTree: async pid => {
      killedPid = pid;
      setImmediate(() => child.emit("close", null, "SIGTERM"));
    }
  });
  const pending = runner.run("winget.exe", ["upgrade"], { signal: controller.signal });
  controller.abort();
  const result = await pending;
  assert.equal(killedPid, 42);
  assert.equal(result.cancelled, true);
});
