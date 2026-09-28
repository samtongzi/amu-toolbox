const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

test('Electron runtime extracts and replaces ASAR-bearing apps without virtual filesystem interference', { skip: process.platform !== 'darwin', timeout: 60000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'amu-electron-installer-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const resources = path.join(root, 'Example.app/Contents/Resources');
  const source = path.join(root, 'asar-source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'message.txt'), 'asar payload');
  await fs.mkdir(resources, { recursive: true });
  await require('@electron/asar').createPackage(source, path.join(resources, 'app.asar'));
  await fs.mkdir(path.join(resources, 'app.asar.unpacked'));
  await fs.writeFile(path.join(resources, 'app.asar.unpacked/native.node'), 'unpacked payload');
  await execFile('/usr/bin/ditto', ['-c', '-k', '--keepParent', path.join(root, 'Example.app'), path.join(root, 'fixture.zip')]);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = await execFile(require('electron'), [path.resolve(__dirname, '../scripts/electron-installer-harness.cjs'), root], { env, timeout: 45000 });
  assert.match(result.stdout, /byte integrity, rollback and replacement: PASS/);
});
