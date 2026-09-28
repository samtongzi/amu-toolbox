const test = require('node:test');
const assert = require('node:assert/strict');
const { AppScanner, selectSparkleUpdate, selectSublimeUpdate, fetchText } = require('../src/macos/app-scanner');
const { MacClient } = require('../src/macos/client');
const { HomebrewClient } = require('../src/homebrew/client');
const { ScanService } = require('../src/services/scan-service');
const { UpdateService } = require('../src/services/update-service');
const feed = body => `<rss><channel>${body}</channel></rss>`;
const entry = (build, version, extra = '') => `<item>${extra}<enclosure url="https://vendor.example/app.dmg" sparkle:version="${build}" sparkle:shortVersionString="${version}"/></item>`;
test('Sparkle detects App Cleaner build updates and Hopper demo versions', () => {
  assert.equal(selectSparkleUpdate(feed(entry('2336', '10.0.1')), { build: '2318', version: '10.0' }, '27.0').version, '10.0.1');
  assert.equal(selectSparkleUpdate(feed(entry('42.6316032', '6.6.0-demo')), { build: '42.6299776', version: '6.2.8-demo' }, '27.0').version, '6.6.0-demo');
  assert.equal(selectSparkleUpdate(feed(entry('2336', '10.0.1')), { build: '2336', version: '10.0.1' }, '27.0'), null);
});
test('Sparkle excludes beta channels, unsupported macOS, deltas and unsafe downloads', () => {
  const xml = feed(entry('5', '5.0', '<sparkle:channel>beta</sparkle:channel>') + entry('4', '4.0', '<sparkle:minimumSystemVersion>99.0</sparkle:minimumSystemVersion>') +
    '<item><enclosure sparkle:version="6" sparkle:deltaFrom="1" url="https://vendor.example/delta"/></item>' +
    '<item><enclosure sparkle:version="7" url="http://vendor.example/app"/></item>' + entry('2', '2.0'));
  assert.equal(selectSparkleUpdate(xml, { build: '1', version: '1' }, '27').build, '2');
  assert.throws(() => selectSparkleUpdate('<html/>', { build: '1' }, '27'));
});
test('separate installed copies with the same bundle id remain separate and failures remain visible', async () => {
  const apps = ['/Applications/Hopper.app', '/Applications/Hopper v4.app'].map(appPath => ({ appPath, name: 'Hopper', bundleId: 'com.hopper', version: '1', build: '1', feedUrl: 'https://vendor.example/feed' }));
  apps.push({ name: 'Other', appPath: '/Applications/Other.app', bundleId: 'com.other', version: '1' });
  const scanner = new AppScanner({ listApps: async () => apps, fetcher: async () => new Response(feed(entry('2', '2'))), systemVersion: '27' });
  const result = await scanner.scan();
  assert.equal(result.packages.length, 2);
  assert.notEqual(result.packages[0].id, result.packages[1].id);
  assert.equal(result.coverage.unsupported, 1);
  scanner.fetcher = async () => new Response('', { status: 403 });
  const failed = await scanner.scan();
  assert.equal(failed.warnings.length, 2);
  assert.equal(failed.coverage.checked, 0);
});
test('App Store matches exact bundle identity and checks version', async () => {
  const scanner = new AppScanner({ listApps: async () => [{ appPath: '/Applications/App.app', name: 'App', bundleId: 'com.app', version: '1', appStore: true }],
    fetcher: async () => new Response(JSON.stringify({ results: [{ kind: 'mac-software', bundleId: 'com.app', version: '2' }] })) });
  const result = await scanner.scan();
  assert.equal(result.packages[0].source, 'app-store');
  assert.equal(result.packages[0].updateMode, 'external');
});
test('bounded feed fetch rejects insecure URLs and oversized responses', async () => {
  await assert.rejects(fetchText('http://vendor.example/feed'), /HTTPS/);
  await assert.rejects(fetchText('https://vendor.example/feed', { fetcher: async () => new Response('12345'), maxBytes: 4 }), /过大/);
});
test('Mac scan never invokes Homebrew and silently skips failed update sources', async () => {
  const apps = ['working', 'http400', 'offline'].map(name => ({ appPath: `/Applications/${name}.app`, name,
    bundleId: `com.${name}`, version: '1', build: '1', feedUrl: `https://${name}.example/feed` }));
  const scanner = new AppScanner({ listApps: async () => apps, fetcher: async url => {
    if (url.includes('http400')) return new Response('', { status: 400 });
    if (url.includes('offline')) throw new Error('fetch failed');
    return new Response(feed(entry('2', '2')));
  } });
  const unexpectedBrew = () => { throw new Error('Homebrew must not be called'); };
  const client = new MacClient({ homebrew: { probe: unexpectedBrew, scan: unexpectedBrew }, scanner });
  assert.equal((await client.probe()).version, '官网 / App Store');
  const result = await client.scan();
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.packages.map(p => p.name), ['working']);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.diagnostic, '');
  assert.equal(result.coverage, undefined);
  scanner.fetcher = async () => { throw new Error('offline'); };
  assert.deepEqual((await client.scan()).packages, []);
  const controller = new AbortController(); controller.abort();
  assert.equal((await client.scan({ signal: controller.signal })).status, 'cancelled');
});
test('Mac website updates open their original app and cannot run package manager updates', async () => {
  const pkg = { id: 'external', source: 'sparkle', updateMode: 'external', appPath: '/Applications/Example.app' };
  let opened;
  const client = new MacClient({ scanner: { scan: async () => ({ packages: [pkg], warnings: [] }) },
    shell: { openPath: async appPath => { opened = appPath; return ''; } } });
  const scans = new ScanService({ client }); const result = await scans.scan();
  const updates = new UpdateService({ client, scanService: scans });
  await assert.rejects(updates.start({ snapshotId: result.snapshot.snapshotId, packageKeys: [result.snapshot.packages[0].packageKey] }), { code: 'external-update' });
  assert.throws(() => client.update({ source: 'homebrew-cask' }), /原应用/);
  await client.openUpdate(pkg);
  assert.equal(opened, pkg.appPath);
});
test('Homebrew retries only lock contention, including cancellation during backoff', async () => {
  let calls = 0;
  const client = new HomebrewClient({ runner: { run: async () => ++calls === 1 ? { code: 1, stderr: 'Another process has already locked app' } : { code: 0 } }, wait: async () => {} });
  assert.equal((await client.update({ id: 'example', source: 'homebrew-cask' })).ok, true);
  assert.equal(calls, 2);
  const controller = new AbortController();
  client.runner.run = async () => ({ code: 1, stderr: 'has already locked' });
  client.wait = async () => { controller.abort(); throw new Error('aborted'); };
  assert.equal((await client.update({ id: 'example', source: 'homebrew-cask' }, { signal: controller.signal })).code, 'update-cancelled');
});

test('Sublime stable updates compare build numbers and enforce macOS compatibility', () => {
  const data = { latest_version: 4215, minimum_platform_version_osx: '10.13' };
  const app = { version: 'Build 4200', build: '4200' };
  assert.deepEqual(selectSublimeUpdate(data, app, '27.0'), { version: 'Build 4215', build: '4215' });
  assert.equal(selectSublimeUpdate(data, { ...app, build: '4215' }, '27.0'), null);
  assert.equal(selectSublimeUpdate(data, { ...app, build: '4216' }, '27.0'), null);
  assert.equal(selectSublimeUpdate(data, app, '10.12'), null);
  for (const latest_version of [null, '4215', -1, 4215.5]) {
    assert.throws(() => selectSublimeUpdate({ ...data, latest_version }, app, '27.0'), /构建号/);
  }
  assert.throws(() => selectSublimeUpdate(data, { ...app, build: '' }, '27.0'), /构建号/);
  assert.throws(() => selectSublimeUpdate({ ...data, minimum_platform_version_osx: {} }, app, '27.0'), /系统版本/);
});
test('Sublime without Sparkle uses its official endpoint and prepares an automatic update', async () => {
  const app = { appPath: '/Applications/Sublime Text.app', name: 'Sublime Text', bundleId: 'com.sublimetext.4', version: 'Build 4200', build: '4200' };
  let requested, opened;
  const scanner = new AppScanner({ listApps: async () => [app], systemVersion: '27.0', fetcher: async url => {
    requested = url;
    return new Response(JSON.stringify({ latest_version: 4215, minimum_platform_version_osx: '10.13' }));
  } });
  const client = new MacClient({ scanner, shell: { openPath: async appPath => { opened = appPath; return ''; } } });
  const result = await client.scan();
  assert.equal(requested, 'https://www.sublimetext.com/updates/4/stable_update_check?version=4200&platform=osx&arch=arm64');
  assert.equal(result.packages[0].availableVersion, 'Build 4215');
  assert.equal(result.packages[0].installedVersion, 'Build 4200');
  assert.equal(result.packages[0].source, 'sublime-text');
  assert.equal(result.packages[0].updateMode, 'automatic');
  assert.equal(result.packages[0].downloadUrl, 'https://download.sublimetext.com/sublime_text_build_4215_mac.zip');
  await assert.rejects(client.openUpdate(result.packages[0]), /直接更新/);
  scanner.fetcher = async () => { throw new Error('ECONNREFUSED'); };
  assert.deepEqual((await client.scan()).packages, []);
  assert.deepEqual((await client.scan()).warnings, []);
  scanner.listApps = async () => [{ ...app, bundleId: 'com.unrelated' }];
  let unrelatedRequests = 0;
  scanner.fetcher = async () => { unrelatedRequests++; return new Response('{}'); };
  assert.deepEqual((await scanner.scan()).packages, []);
  assert.equal(unrelatedRequests, 0);
});

test('Claude official release manifest produces a verified matching full-package target', async () => {
  const { selectClaudeUpdate } = require('../src/macos/app-scanner');
  const app = { bundleId: 'com.anthropic.claudefordesktop', name: 'Claude', appPath: '/Applications/Claude.app', version: '2.7032.0', build: '2.7032.0' };
  const release = { currentRelease: '2.9939.2', releases: [{ version: '2.9939.2', updateTo: { version: '2.9939.2', url: 'https://downloads.claude.ai/releases/darwin/universal/2.9939.2/Claude.zip' } }] };
  const result = await new AppScanner({ listApps: async () => [app], fetcher: async url => {
    assert.equal(url, 'https://downloads.claude.ai/releases/darwin/universal/RELEASES.json');
    return new Response(JSON.stringify(release));
  } }).scan();
  assert.equal(result.packages[0].availableBuild, '2.9939.2');
  assert.equal(result.packages[0].updateMode, 'automatic');
  assert.equal(selectClaudeUpdate(release, { ...app, version: '2.9939.2' }), null);
  release.releases[0].updateTo.url = 'https://other.example/Claude.zip';
  assert.throws(() => selectClaudeUpdate(release, app), /地址/);
  release.releases[0].updateTo.version = '2.9939.1';
  assert.throws(() => selectClaudeUpdate(release, app), /不一致/);
  assert.throws(() => selectClaudeUpdate({ currentRelease: 'bad' }, app), /无效/);
});
test('MacWhisper feed with item-level versions is detected and respects minimum macOS', async () => {
  const xml = '<rss><channel><item><sparkle:version>1521</sparkle:version><sparkle:shortVersionString>15.2.1</sparkle:shortVersionString><sparkle:minimumSystemVersion>15.0</sparkle:minimumSystemVersion><enclosure url="https://cdn.macwhisper.com/macwhisper/MacWhisper-1521.zip"/></item></channel></rss>';
  const app = { bundleId: 'com.goodsnooze.MacWhisper', name: 'MacWhisper', version: '15.1.1', build: '1513', feedUrl: 'https://macwhisper-site.vercel.app/appcast.xml', appPath: '/Applications/MacWhisper.app' };
  const scanner = new AppScanner({ systemVersion: '27.0', listApps: async () => [app], fetcher: async () => new Response(xml) });
  assert.equal((await scanner.scan()).packages[0].availableVersion, '15.2.1');
  scanner.systemVersion = '14.0';
  assert.equal((await scanner.scan()).packages.length, 0);
});
