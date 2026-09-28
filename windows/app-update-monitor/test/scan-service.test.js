const test = require("node:test");
const assert = require("node:assert/strict");
const { ScanService } = require("../src/services/scan-service");
const { WingetClient } = require("../src/winget/client");

const pkg = { name: "Tool", id: "Vendor.Tool", installedVersion: "1", availableVersion: "2", source: "winget", installedVersionUnknown: false };

test("creates opaque package keys and rejects stale snapshots", async () => {
  const service = new ScanService({ client: { scan: async () => ({ status: "ready", code: "ok", packages: [pkg], warnings: [] }) } });
  const result = await service.scan();
  const listed = result.snapshot.packages[0];
  assert.ok(listed.packageKey);
  assert.deepEqual(service.resolvePackages(result.snapshot.snapshotId, [listed.packageKey])[0].id, pkg.id);
  assert.throws(() => service.resolvePackages("stale", [listed.packageKey]), error => error.code === "stale-snapshot");
});

test("merges concurrent scans", async () => {
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const service = new ScanService({ client: { scan: async () => { calls += 1; await pending; return { status: "ready", code: "ok", packages: [], warnings: [] }; } } });
  const first = service.scan();
  const second = service.scan();
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("Chinese no-updates response passes through client and replaces a previous list", async () => {
  let result = { status: "ready", code: "ok", packages: [pkg], warnings: [] };
  const client = new WingetClient({ runner: { run: async () => ({ code: 0, stdout: "找不到与输入条件匹配的已安装程序包。\r\n", stderr: "" }) } });
  const service = new ScanService({ client: { scan: async () => result } });
  await service.scan();
  result = await client.scan();
  const scanned = await service.scan();
  assert.equal(scanned.status, "ready");
  assert.equal(scanned.code, "no-updates");
  assert.equal(scanned.snapshot.status, "ready");
  assert.deepEqual(scanned.snapshot.packages, []);
});

test("failed scans log the actual reason and exit code at error level", async () => {
  const logs = [];
  const service = new ScanService({ client: { scan: async () => ({
    status: "error", code: "source-error", packages: [], warnings: [],
    exitCode: { hex: "0x80072EE7" }, diagnostic: "打开源失败：无法解析服务器名称"
  }) }, onLog: (...args) => logs.push(args) });
  await service.scan();
  assert.equal(logs[0][0], "error");
  assert.match(logs[0][3], /0x80072EE7/);
  assert.match(logs[0][3], /无法解析服务器名称/);
  assert.doesNotMatch(logs[0][3], /完成，发现/);
});
