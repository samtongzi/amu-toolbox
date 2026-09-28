const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { XMLParser } = require('fast-xml-parser');
const { compareVersions } = require('../services/update-verification');
const exec = promisify(execFile);
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'string' ? value : '';

async function mapLimit(items, limit, fn) {
  let next = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await fn(items[index]); }
  }));
  return results;
}

async function listApplications(roots = ['/Applications', path.join(os.homedir(), 'Applications')]) {
  const bundles = [];
  async function visit(directory, depth) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const file = path.join(directory, entry.name);
      if (entry.name.endsWith('.app')) bundles.push(file);
      else if (depth < 2) await visit(file, depth + 1);
    }
  }
  for (const root of roots) await visit(root, 0);
  return (await mapLimit(bundles, 6, async appPath => {
    try {
      const { stdout } = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Contents/Info.plist')], { timeout: 5000, maxBuffer: 1024 * 1024 });
      const info = JSON.parse(stdout);
      if (!info.CFBundleIdentifier) return null;
      return { appPath, name: path.basename(appPath, '.app'), bundleId: info.CFBundleIdentifier,
        version: text(info.CFBundleShortVersionString), build: text(info.CFBundleVersion),
        feedUrl: text(info.SUFeedURL), appStore: !!(await fs.stat(path.join(appPath, 'Contents/_MASReceipt/receipt')).catch(() => null)) };
    } catch { return null; }
  })).filter(Boolean);
}

function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

async function fetchText(url, { fetcher = fetch, signal, userAgent = 'AmuToolbox/1.1', maxBytes = 3 * 1024 * 1024 } = {}) {
  if (!httpsUrl(url)) throw new Error('更新源必须使用 HTTPS');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { 'User-Agent': userAgent, Accept: 'application/xml, application/json, text/xml, */*' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.url && !httpsUrl(response.url)) throw new Error('更新源重定向到非 HTTPS 地址');
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maxBytes) { controller.abort(); throw new Error('更新源响应过大'); }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

function selectSparkleUpdate(xml, app, systemVersion) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, parseAttributeValue: false, processEntities: false });
  const doc = parser.parse(xml, true);
  if (!doc.rss?.channel) throw new Error('不是有效的 Sparkle 更新源');
  const candidates = [];
  for (const item of array(doc.rss.channel.item)) {
    const channel = text(item['sparkle:channel']);
    if (channel && channel !== 'stable') continue;
    const minimum = text(item['sparkle:minimumSystemVersion']);
    const maximum = text(item['sparkle:maximumSystemVersion']);
    if (minimum && compareVersions(systemVersion, minimum) === -1) continue;
    if (maximum && compareVersions(systemVersion, maximum) === 1) continue;
    for (const enclosure of array(item.enclosure)) {
      if (enclosure['sparkle:deltaFrom'] || (enclosure['sparkle:os'] && enclosure['sparkle:os'] !== 'macos')) continue;
      const version = text(enclosure['sparkle:shortVersionString'] || item['sparkle:shortVersionString']);
      const build = text(enclosure['sparkle:version'] || item['sparkle:version']);
      const downloadUrl = httpsUrl(enclosure.url);
      if (!downloadUrl || !build) continue;
      // Sparkle compares bundle build numbers, which also keeps demo and release feeds separate.
      const newer = compareVersions(build, app.build);
      if (newer === 1 || (newer === null && compareVersions(version, app.version) === 1)) candidates.push({ version: version || build, build, downloadUrl, downloadFormat: /\.zip$/i.test(new URL(downloadUrl).pathname) ? 'zip' : /\.dmg$/i.test(new URL(downloadUrl).pathname) ? 'dmg' : null });
    }
  }
  return candidates.sort((a, b) => compareVersions(b.build, a.build) || 0)[0] || null;
}

function selectClaudeUpdate(data, app) {
  const version = data?.currentRelease;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) || !Array.isArray(data.releases)) throw new Error('应用更新信息无效');
  const newer = compareVersions(version, app.version || app.build);
  if (newer === null) throw new Error('本机应用版本无效');
  if (newer <= 0) return null;
  const release = data.releases.find(item => item.version === version)?.updateTo;
  if (!release || release.version !== version) throw new Error('应用更新版本不一致');
  const downloadUrl = httpsUrl(release.url);
  const url = downloadUrl && new URL(downloadUrl);
  if (!url || url.hostname !== 'downloads.claude.ai' || !url.pathname.startsWith(`/releases/darwin/universal/${version}/`) || !url.pathname.endsWith('.zip')) throw new Error('应用下载地址无效');
  return { version, build: version, downloadUrl, downloadFormat: 'zip' };
}

function selectSublimeUpdate(data, app, systemVersion) {
  const installed = /^\d+$/.test(app.build) ? Number(app.build) : NaN;
  const latest = data.latest_version;
  if (!Number.isSafeInteger(installed) || installed <= 0 || !Number.isSafeInteger(latest) || latest <= 0) {
    throw new Error('Sublime Text 构建号无效');
  }
  const minimum = data.minimum_platform_version_osx;
  if (minimum != null) {
    const compatible = typeof minimum === 'string' ? compareVersions(systemVersion, minimum) : null;
    if (compatible === null) throw new Error('Sublime Text 系统版本要求无效');
    if (compatible === -1) return null;
  }
  return latest > installed ? { version: `Build ${latest}`, build: String(latest) } : null;
}

class AppScanner {
  constructor({ fetcher = fetch, listApps = listApplications, systemVersion = '12.0', getIcon = async () => null } = {}) {
    Object.assign(this, { fetcher, listApps, systemVersion, getIcon });
  }
  async scan({ signal } = {}) {
    const apps = await this.listApps();
    const warnings = [], packages = [];
    let checked = 0, unsupported = 0;
    await mapLimit(apps, 6, async app => {
      if (signal?.aborted) return;
      const id = `${app.bundleId}@${createHash('sha256').update(app.appPath).digest('hex').slice(0, 12)}`;
      const base = { id, bundleId: app.bundleId, installedBuild: app.build, name: app.name, installedVersion: app.version || app.build, installedVersionUnknown: false, appPath: app.appPath, updateMode: 'external' };
      try {
        if (app.appStore) {
          let found;
          for (const country of ['cn', 'us']) {
            const data = JSON.parse(await fetchText(`https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(app.bundleId)}&entity=macSoftware&country=${country}`, { fetcher: this.fetcher, signal }));
            if (!Array.isArray(data.results)) throw new Error('App Store 返回格式不正确');
            found = data.results.find(row => row.bundleId === app.bundleId && row.kind === 'mac-software');
            if (found) break;
          }
          if (!found) { unsupported++; return; }
          const comparison = compareVersions(found.version, app.version);
          if (comparison === null) { unsupported++; return; }
          checked++;
          if (comparison === 1) packages.push({ ...base, source: 'app-store', availableVersion: found.version });
        } else if (app.bundleId === 'com.anthropic.claudefordesktop') {
          const data = JSON.parse(await fetchText('https://downloads.claude.ai/releases/darwin/universal/RELEASES.json', { fetcher: this.fetcher, signal }));
          const update = selectClaudeUpdate(data, app);
          checked++;
          if (update) packages.push({ ...base, source: 'claude', availableVersion: update.version, availableBuild: update.build,
            downloadUrl: update.downloadUrl, downloadFormat: update.downloadFormat, updateMode: 'automatic' });
        } else if (app.bundleId === 'com.sublimetext.4') {
          if (!/^\d+$/.test(app.build)) throw new Error('Sublime Text 构建号无效');
          // Sublime uses its own JSON updater, not a Sparkle feed. Only query stable releases.
          const url = `https://www.sublimetext.com/updates/4/stable_update_check?version=${app.build}&platform=osx&arch=arm64`;
          const data = JSON.parse(await fetchText(url, { fetcher: this.fetcher, signal }));
          const update = selectSublimeUpdate(data, app, this.systemVersion);
          checked++;
          if (update) packages.push({ ...base, source: 'sublime-text', installedVersion: `Build ${app.build}`,
            availableVersion: update.version, availableBuild: update.build, updateMode: 'automatic', downloadFormat: 'zip',
            downloadUrl: `https://download.sublimetext.com/sublime_text_build_${update.build}_mac.zip` });
        } else if (httpsUrl(app.feedUrl)) {
          const xml = await fetchText(app.feedUrl, { fetcher: this.fetcher, signal, userAgent: `${app.name}/${app.build || app.version} Sparkle/2.8.0 AmuToolbox/1.1` });
          const update = selectSparkleUpdate(xml, app, this.systemVersion);
          checked++;
          if (update) packages.push({ ...base, source: 'sparkle', availableVersion: update.version, availableBuild: update.build,
            downloadUrl: update.downloadUrl, downloadFormat: update.downloadFormat, updateMode: update.downloadFormat ? 'automatic' : 'external' });
        } else unsupported++;
      } catch (error) { warnings.push(`${app.name}：${error.message}`); }
    });
    await mapLimit(packages, 6, async pkg => { pkg.icon = await this.getIcon(pkg.appPath).catch(() => null); });
    return { installations: apps.map(({ appPath, bundleId, version, build }) => ({ appPath, bundleId, version, build })), packages: packages.sort((a, b) => a.name.localeCompare(b.name)), warnings, coverage: { total: apps.length, checked, unsupported, failed: warnings.length } };
  }
}
module.exports = { AppScanner, listApplications, selectSparkleUpdate, selectSublimeUpdate, selectClaudeUpdate, httpsUrl, fetchText };
