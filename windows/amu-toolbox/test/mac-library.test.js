const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { MacLibrary } = require('../src/mac-library');
const { validateEntries } = require('../src/mac-platform');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'amu-mac-test-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('amu-mac-test-')); await fs.rm(root, { recursive: true, force: true }); });
  const data = Buffer.from('test archive');
  const app = { id: 'sample', name: '示例工具', file: 'sample.zip', bundleName: '示例工具.app', bundleExecutable: '示例工具', bundleId: 'cn.test.sample', version: '1.0', size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
  const packageRoot = path.join(root, 'packages');
  await fs.mkdir(packageRoot); await fs.writeFile(path.join(packageRoot, app.file), data);
  let running = false, failExtract = false, failStartup = false, startupCalls = 0;
  const platform = { isRunning: async () => running, launch: async () => {},
    extract: async (_archive, stage, item) => { if (failExtract) throw new Error('签名无效'); const dir = path.join(stage, item.bundleName, 'Contents', 'MacOS'); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, item.bundleExecutable), 'test'); },
    removeOwnedStartup: async () => { startupCalls++; if (failStartup) throw new Error('登录启动清理失败'); } };
  const lib = new MacLibrary({ catalog: [app], packageRoot, installRoot: path.join(root, 'apps'), platform });
  return { lib, app, root, running: () => { running = true; }, failExtract: () => { failExtract = true; }, failStartup: () => { failStartup = true; }, startupCalls: () => startupCalls };
}
test('Mac archive installs a bundle and exports the original verified ZIP', async t => {
  const h = await fixture(t); await h.lib.install(h.app.id);
  assert.equal((await h.lib.installed(h.app)).version, '1.0');
  assert.ok(h.lib.executable(h.app.id).endsWith('.app'));
  await h.lib.exportPackage(h.app.id, path.join(h.root, 'export.zip'));
  assert.equal((await fs.readFile(path.join(h.root, 'export.zip'))).toString(), 'test archive');
});
test('signature/extraction failure preserves an installed version', async t => {
  const h = await fixture(t); await h.lib.install(h.app.id); h.app.version = '2.0'; h.failExtract();
  await assert.rejects(h.lib.install(h.app.id), /签名无效/);
  assert.equal((await h.lib.installed(h.app)).version, '1.0');
  assert.deepEqual(await fs.readdir(h.lib.installRoot), ['sample']);
});
test('corrupt Mac archive never becomes installed', async t => {
  const h = await fixture(t); await fs.writeFile(path.join(h.lib.packageRoot, h.app.file), 'corrupt');
  await assert.rejects(h.lib.install(h.app.id), /校验失败/);
  assert.equal(await h.lib.installed(h.app), null);
});
test('Mac uninstall clears its own login item and keeps unrelated data', async t => {
  const h = await fixture(t); await h.lib.install(h.app.id); await fs.writeFile(path.join(h.root, 'state.json'), 'history');
  await h.lib.uninstall(h.app.id); assert.equal(h.startupCalls(), 1);
  assert.equal(await h.lib.installed(h.app), null); assert.equal(await fs.readFile(path.join(h.root, 'state.json'), 'utf8'), 'history');
});
test('startup cleanup failure retains the app for recovery', async t => {
  const h = await fixture(t); await h.lib.install(h.app.id); h.failStartup();
  await assert.rejects(h.lib.uninstall(h.app.id), /登录启动清理失败/);
  assert.ok(await h.lib.installed(h.app));
});
test('running Mac tools block update and uninstall', async t => {
  const h = await fixture(t); await h.lib.install(h.app.id); h.running();
  await assert.rejects(h.lib.install(h.app.id), /顶部菜单栏/);
  await assert.rejects(h.lib.uninstall(h.app.id), /顶部菜单栏/);
});
test('archive validation rejects traversal, absolute paths and other apps', () => {
  validateEntries('Example.app/Contents/Info.plist\nExample.app/Contents/MacOS/Example\n', 'Example.app');
  for (const list of ['../escape', '/tmp/escape', 'Example.app/../escape', 'Other.app/file', 'Example.app/Contents/..\\escape', '']) assert.throws(() => validateEntries(list, 'Example.app'));
});
