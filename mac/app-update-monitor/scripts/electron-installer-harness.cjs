// Helper launched by mac-installer-electron.test.js inside a real Electron process.
const { app } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('original-fs').promises;
const patchedFs = require('node:fs/promises');
const { unpackZip, replaceBundle } = require('../src/macos/installer');
const root = process.argv[2];
app.whenReady().then(async () => {
  app.dock?.hide();
  const out = path.join(root, 'out');
  await fs.mkdir(out);
  await unpackZip(path.join(root, 'fixture.zip'), out);
  const bundle = path.join(out, 'Example.app');
  const relative = 'Contents/Resources/app.asar';
  const expected = await fs.readFile(path.join(root, 'Example.app', relative));
  assert.deepEqual(await fs.readFile(path.join(bundle, relative)), expected);
  assert.equal((await fs.stat(path.join(bundle, relative))).isFile(), true);
  // Ordinary application reads must still work; never toggle global process.noAsar.
  assert.equal(await patchedFs.readFile(path.join(bundle, relative, 'message.txt'), 'utf8'), 'asar payload');
  assert.equal(await fs.readFile(path.join(bundle, relative + '.unpacked/native.node'), 'utf8'), 'unpacked payload');
  const destination = path.join(root, 'Installed.app');
  await fs.mkdir(destination);
  await fs.writeFile(path.join(destination, 'old'), 'old app');
  await assert.rejects(replaceBundle(bundle, destination, async () => { throw new Error('verify failed'); }), /verify failed/);
  assert.equal(await fs.readFile(path.join(destination, 'old'), 'utf8'), 'old app');
  await unpackZip(path.join(root, 'fixture.zip'), out);
  await replaceBundle(bundle, destination, async target => {
    assert.deepEqual(await fs.readFile(path.join(target, relative)), expected);
  });
  assert.deepEqual(await fs.readFile(path.join(destination, relative)), expected);
  assert.equal((await fs.readdir(root)).some(name => name.includes('.amu-backup-')), false);
  console.log('Electron ASAR extraction, byte integrity, rollback and replacement: PASS');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
