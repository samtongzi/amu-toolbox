const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { Library, inside } = require("../src/library");
const hash = data => crypto.createHash("sha256").update(data).digest("hex");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "amu-library-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("amu-library-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const packageRoot = path.join(root, "packages"), installRoot = path.join(root, "apps"), shortcutsRoot = path.join(root, "shortcuts");
  await fs.mkdir(packageRoot);
  const data = Buffer.from("MZ fake test package".repeat(100));
  const app = { id: "sample", name: "示例应用", file: "sample.exe", version: "1.0.0", description: "Test", startupName: "AmuTest", size: data.length, sha256: hash(data) };
  await fs.writeFile(path.join(packageRoot, app.file), data);
  let running = false, shortcutWorks = true;
  const shortcuts = new Map(), launches = [], removedStartup = [];
  const shell = { writeShortcutLink: (file, mode, details) => { if (!shortcutWorks) return false; shortcuts.set(file, details); return true; }, readShortcutLink: file => { if (!shortcuts.has(file)) throw new Error("missing"); return shortcuts.get(file); } };
  const platform = { isRunning: async () => running, launch: async file => launches.push(file), removeOwnedStartup: async (...args) => removedStartup.push(args) };
  const lib = new Library({ catalog: [app], packageRoot, installRoot, shortcutsRoot, shell, platform });
  return { lib, root, app, data, shortcuts, launches, removedStartup, setRunning: value => { running = value; }, failShortcut: () => { shortcutWorks = false; } };
}

test("installs exact package, records metadata and creates a managed shortcut", async t => {
  const h = await fixture(t);
  assert.equal((await h.lib.snapshot()).apps[0].installed, null);
  await h.lib.install("sample");
  assert.deepEqual(await fs.readFile(h.lib.executable("sample")), h.data);
  const state = await h.lib.snapshot();
  assert.equal(state.apps[0].installed.version, "1.0.0");
  assert.equal(state.jobs[0].status, "completed");
  assert.equal(state.busy, false);
  assert.equal(h.shortcuts.get(h.lib.shortcut("sample")).target, h.lib.executable("sample"));
});

test("corrupt offline package never becomes installed and staging is cleaned", async t => {
  const h = await fixture(t);
  await fs.writeFile(path.join(h.lib.packageRoot, h.app.file), Buffer.alloc(h.data.length, 1));
  await assert.rejects(h.lib.install("sample"), /校验失败/);
  assert.equal(await h.lib.installed(h.app), null);
  assert.deepEqual(await fs.readdir(h.lib.installRoot), []);
  assert.equal(h.lib.jobs[0].status, "failed");
});

test("cancel during copying preserves a previously installed version", async t => {
  const h = await fixture(t); await h.lib.install("sample");
  const newer = Buffer.alloc(4 * 1024 * 1024, 2);
  Object.assign(h.app, { version: "2.0.0", size: newer.length, sha256: hash(newer) });
  await fs.writeFile(path.join(h.lib.packageRoot, h.app.file), newer);
  h.lib.onChange = () => { if (h.lib.active?.percent > 0) h.lib.cancel(); };
  const result = await h.lib.install("sample");
  assert.equal(result.cancelled, true);
  assert.equal((await h.lib.installed(h.app)).version, "1.0.0");
  assert.deepEqual(await fs.readFile(h.lib.executable("sample")), h.data);
  assert.deepEqual(await fs.readdir(h.lib.installRoot), ["sample"]);
});

test("shortcut failure rolls an update back to the previous executable", async t => {
  const h = await fixture(t); await h.lib.install("sample"); h.failShortcut();
  const newer = Buffer.from("MZ newer package");
  Object.assign(h.app, { version: "2.0.0", size: newer.length, sha256: hash(newer) });
  await fs.writeFile(path.join(h.lib.packageRoot, h.app.file), newer);
  await assert.rejects(h.lib.install("sample"), /快捷方式/);
  assert.deepEqual(await fs.readFile(h.lib.executable("sample")), h.data);
  assert.equal((await h.lib.installed(h.app)).version, "1.0.0");
  assert.deepEqual(await fs.readdir(h.lib.installRoot), ["sample"]);
});

test("a successful update replaces both version and executable", async t => {
  const h = await fixture(t); await h.lib.install("sample");
  const newer = Buffer.from("new v2 bytes");
  Object.assign(h.app, { version: "2.0.0", size: newer.length, sha256: hash(newer) });
  await fs.writeFile(path.join(h.lib.packageRoot, h.app.file), newer);
  await h.lib.install("sample");
  assert.equal((await h.lib.installed(h.app)).version, "2.0.0");
  assert.deepEqual(await fs.readFile(h.lib.executable("sample")), newer);
});

test("running tools cannot be updated or uninstalled", async t => {
  const h = await fixture(t); await h.lib.install("sample"); h.setRunning(true);
  await assert.rejects(h.lib.install("sample"), /正在运行/);
  await assert.rejects(h.lib.uninstall("sample"), /正在运行/);
  assert.ok(await h.lib.installed(h.app));
});

test("uninstall only removes managed files and retains unrelated user data", async t => {
  const h = await fixture(t); await h.lib.install("sample");
  const userData = path.join(h.root, "original-settings.json");
  await fs.writeFile(userData, "keep");
  await h.lib.uninstall("sample");
  assert.equal(await h.lib.installed(h.app), null);
  assert.equal(await fs.readFile(userData, "utf8"), "keep");
  assert.deepEqual(h.removedStartup, [["AmuTest", h.lib.executable("sample")]]);
});

test("unknown ids and escaping paths are rejected", async t => {
  const h = await fixture(t);
  await assert.rejects(h.lib.install("../sample"), /未找到/);
  await assert.rejects(h.lib.uninstall("not-an-app"), /未找到/);
  assert.throws(() => inside(h.root, "../outside"), /无效/);
  assert.throws(() => inside(h.root, "."), /无效/);
});

test("an existing unrecognized directory is preserved", async t => {
  const h = await fixture(t);
  await fs.mkdir(h.lib.directory("sample"), { recursive: true });
  await fs.writeFile(path.join(h.lib.directory("sample"), "personal.txt"), "keep");
  await assert.rejects(h.lib.install("sample"), /无法识别/);
  assert.equal(await fs.readFile(path.join(h.lib.directory("sample"), "personal.txt"), "utf8"), "keep");
});

test("junctions cannot redirect installation or removal outside the managed root", async t => {
  const h = await fixture(t);
  const outside = path.join(h.root, "outside");
  await fs.mkdir(outside); await fs.mkdir(h.lib.installRoot);
  await fs.symlink(outside, h.lib.directory("sample"), "junction");
  await assert.rejects(h.lib.install("sample"), /包含链接/);
  await assert.rejects(h.lib.uninstall("sample"), /尚未/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("exports exact standalone package without installing it", async t => {
  const h = await fixture(t), destination = path.join(h.root, "export.exe");
  await h.lib.exportPackage("sample", destination);
  assert.deepEqual(await fs.readFile(destination), h.data);
  assert.equal(await h.lib.installed(h.app), null);
  assert.equal(h.lib.jobs[0].path, destination);
});

test("failed export retains an existing destination and removes temporary files", async t => {
  const h = await fixture(t), destination = path.join(h.root, "export.exe");
  await fs.writeFile(destination, "old export");
  h.app.sha256 = "0".repeat(64);
  await assert.rejects(h.lib.exportPackage("sample", destination), /校验失败/);
  assert.equal(await fs.readFile(destination, "utf8"), "old export");
  assert.equal((await fs.readdir(h.root)).some(name => name.endsWith(".part")), false);
});

test("export cannot overwrite bundled or installed executables", async t => {
  const h = await fixture(t);
  await assert.rejects(h.lib.exportPackage("sample", path.join(h.lib.packageRoot, h.app.file)), /其他保存/);
  await assert.rejects(h.lib.exportPackage("sample", h.lib.executable("sample")), /安装目录以外/);
});

test("missing installed binary is detected and cannot be launched", async t => {
  const h = await fixture(t); await h.lib.install("sample");
  await fs.unlink(h.lib.executable("sample"));
  assert.equal((await h.lib.snapshot()).apps[0].installed, null);
  await assert.rejects(h.lib.launch("sample"), /请先安装/);
});

test("launch uses only the catalog-managed executable", async t => {
  const h = await fixture(t); await h.lib.install("sample");
  await h.lib.launch("sample");
  assert.deepEqual(h.launches, [h.lib.executable("sample")]);
});

test("concurrent installation is rejected rather than racing filesystem changes", async t => {
  const h = await fixture(t);
  const first = h.lib.install("sample");
  await assert.rejects(h.lib.install("sample"), /当前任务/);
  await first;
});
