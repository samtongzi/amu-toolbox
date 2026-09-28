const test = require('node:test');
const assert = require('node:assert/strict');
const { HomebrewClient, parseOutdated } = require('../src/homebrew/client');
const { ScanService } = require('../src/services/scan-service');
const { UpdateService } = require('../src/services/update-service');
const row = { name: 'node@22', installed_versions: ['22.1.0'], current_version: '22.2.0' };
const data = { formulae: [row], casks: [{ name: 'visual-studio-code', installed_versions: '1.0', current_version: '2.0' }] };
const success = stdout => ({ code: 0, stdout, stderr: '' });
function fixture(outputs) {
  const calls = [];
  const client = new HomebrewClient({ runner: { run: async (file, args, options) => {
    calls.push({ file, args, options });
    if (!outputs.length) throw new Error('Unexpected command');
    return outputs.shift();
  } } });
  return { client, calls };
}
test('parses formulae and casks including taps and multiple installed versions', () => {
  const result = parseOutdated(JSON.stringify({ ...data, formulae: [{ ...row, name: 'owner/tap/tool', installed_versions: ['1.0','1.1'] }] }));
  assert.equal(result[0].id, 'owner/tap/tool');
  assert.equal(result[0].source, 'homebrew-formula');
  assert.equal(result[0].installedVersion, '1.0, 1.1');
  assert.equal(result[1].source, 'homebrew-cask');
});
test('incomplete or malformed JSON cannot become a successful empty scan', () => {
  for (const input of [{ formulae: [] }, { ...data, casks: [{}] }, { ...data, formulae: [{ ...row, name: '--force' }] }, { ...data, formulae: [row, row] }]) assert.throws(() => parseOutdated(JSON.stringify(input)));
});
test('refreshes metadata before scanning and uses an absolute native brew path', async () => {
  const h = fixture([success('Homebrew 5.0'), success(''), success(JSON.stringify(data))]);
  const result = await h.client.scan();
  assert.equal(result.status, 'ready');
  assert.equal(result.packages.length, 2);
  assert.deepEqual(h.calls.map(c => c.args[0]), ['--version', 'update', 'outdated']);
  assert.equal(h.calls[0].file, '/opt/homebrew/bin/brew');
  assert.equal(h.calls[2].options.env.HOMEBREW_NO_SUDO, '1');
});
test('failed metadata refresh never reports all apps up to date', async () => {
  const h = fixture([success('Homebrew 5.0'), { code: 1, stdout: '', stderr: 'network offline' }]);
  const result = await h.client.scan();
  assert.equal(result.status, 'error');
  assert.match(result.diagnostic, /network offline/);
  assert.equal(h.calls.length, 2);
});
test('missing Homebrew is actionable and can recover without restarting', async () => {
  const h = fixture([{ code: null, spawnError: new Error('ENOENT') }, success('Homebrew 5'), success(''), success('{"formulae":[],"casks":[]}')]);
  assert.equal((await h.client.scan()).code, 'brew-unavailable');
  assert.equal((await h.client.scan()).status, 'ready');
});
test('cancellation and timeouts are not parsed as successful lists', async () => {
  for (const flag of ['cancelled', 'timedOut', 'outputTooLarge']) {
    const h = fixture([success('Homebrew 5'), { ...success(JSON.stringify(data)), [flag]: true }]);
    assert.notEqual((await h.client.scan({ reason: 'postUpdate' })).status, 'ready');
  }
});
test('updates one exact selected package without a shell or forced app quit', async () => {
  const h = fixture([success('done')]);
  await h.client.update({ id: 'owner/tap/tool', source: 'homebrew-cask' });
  assert.deepEqual(h.calls[0].args, ['upgrade', '--cask', '--greedy-auto-updates', '--no-quit', 'owner/tap/tool']);
  for (const id of ['--force', '../a', 'a/../b', 'a;touch evil', '', '/tmp/app.rb']) await assert.rejects(h.client.update({ id, source: 'homebrew-cask' }));
});
test('a nonzero update exit followed by a clean rescan is confirmed successful', async () => {
  const h = fixture([success('Homebrew 5'), success(''), success(JSON.stringify({ formulae: [row], casks: [] })), { code: 1, stdout: '', stderr: 'post-install warning' }, success('Homebrew 5'), success('{"formulae":[],"casks":[]}')]);
  const scanService = new ScanService({ client: h.client });
  const scan = await scanService.scan();
  const service = new UpdateService({ client: h.client, scanService, getConcurrency: () => 1, verificationDelays: [] });
  const completed = new Promise(resolve => service.on('changed', state => { if (state.status === 'completed') resolve(state); }));
  await service.start({ snapshotId: scan.snapshot.snapshotId, packageKeys: [scan.snapshot.packages[0].packageKey] });
  assert.equal((await completed).items[0].status, 'succeeded');
  assert.equal(h.calls.filter(c => c.args[0] === 'update').length, 1);
});
