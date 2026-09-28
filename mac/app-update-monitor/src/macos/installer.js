// Installation operates on physical bundles, including other Electron apps' ASAR
// files. Electron's patched fs interprets those paths as virtual directories.
// Keep normal ASAR support enabled for our own code and scope raw IO here.
const diskFs = process.versions.electron ? require('original-fs') : require('node:fs');
const fs = diskFs.promises;
const { createWriteStream } = diskFs;
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const { isUtf8 } = require('node:buffer');
const { compareVersions } = require('../services/update-verification');
const exec = promisify(execFile);
const MAX_DOWNLOAD = 1024 * 1024 * 1024;
function safeRelative(root, name) {
  if (!name || name.includes('\\') || path.isAbsolute(name) || name.split('/').includes('..')) throw new Error('安装包路径无效');
  const target = path.resolve(root, name);
  if (!target.startsWith(root + path.sep)) throw new Error('安装包路径越界');
  return target;
}
async function unpackZip(archive, root, signal) {
  const zip = await new Promise((resolve, reject) => yauzl.open(archive, { lazyEntries: true, decodeStrings: false }, (e, z) => e ? reject(e) : resolve(z)));
  const links = []; let bytes = 0, count = 0;
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject); zip.on('end', resolve);
      zip.on('entry', entry => {
        (async () => {
          signal?.throwIfAborted();
          if (++count > 100000 || (bytes += entry.uncompressedSize) > 4 * MAX_DOWNLOAD) throw new Error('解压大小超出限制');
          // macOS ditto writes UTF-8 names without the ZIP UTF-8 flag.
          const fileName = !(entry.generalPurposeBitFlag & 0x800) && !entry.extraFields.some(field => field.id === 0x7075) && isUtf8(entry.fileNameRaw)
            ? entry.fileNameRaw.toString('utf8')
            : yauzl.getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, true);
          const target = safeRelative(root, fileName);
          const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
          if (fileName.endsWith('/')) { await fs.mkdir(target, { recursive: true }); return; }
          const stream = await new Promise((res, rej) => zip.openReadStream(entry, (e, s) => e ? rej(e) : res(s)));
          if ((mode & 0xf000) === 0xa000) {
            if (entry.uncompressedSize > 4096) throw new Error('安装包链接无效');
            const chunks = []; await new Promise((resolve, reject) => {
              stream.on('data', chunk => chunks.push(chunk));
              stream.once('end', resolve); stream.once('error', reject);
            });
            const link = Buffer.concat(chunks).toString('utf8');
            const resolved = path.resolve(path.dirname(target), link);
            if (path.isAbsolute(link) || !resolved.startsWith(root + path.sep)) throw new Error('安装包链接越界');
            links.push({ target, link });
          } else {
            await fs.mkdir(path.dirname(target), { recursive: true });
            await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: mode & 0o777 || 0o644 }), { signal });
          }
        })().then(() => zip.readEntry(), reject);
      });
      zip.readEntry();
    });
    for (const { target, link } of links) { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.symlink(link, target); }
  } finally { zip.close(); }
}
async function download(url, target, { signal, onProgress, fetcher = fetch }) {
  let current = new URL(url);
  const timeout = AbortSignal.timeout(10 * 60 * 1000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  for (let redirect = 0; redirect < 6; redirect++) {
    if (current.protocol !== 'https:' || current.username || current.password) throw new Error('下载地址必须使用 HTTPS');
    response = await fetcher(current.href, { signal: combined, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new Error('下载重定向无效');
      current = new URL(location, current); continue;
    }
    break;
  }
  if (!response?.ok) throw new Error(`下载失败（HTTP ${response?.status}）`);
  const total = Number(response.headers.get('content-length'));
  if (total > MAX_DOWNLOAD) { await response.body?.cancel(); throw new Error('下载文件过大'); }
  let bytes = 0, last = 0;
  const file = await fs.open(target, 'wx');
  try {
    for await (const chunk of response.body) {
      combined.throwIfAborted(); bytes += chunk.length;
      if (bytes > MAX_DOWNLOAD) throw new Error('下载文件过大');
      await file.writeFile(chunk);
      if (Date.now() - last > 300) { onProgress?.({ stage: '正在下载', percent: total > 0 ? Math.min(100, Math.round(bytes / total * 100)) : null }); last = Date.now(); }
    }
    if (!bytes || (total > 0 && bytes !== total)) throw new Error('下载文件不完整');
  } finally { await file.close(); }
}
async function readInfo(bundle, run = exec) {
  const { stdout } = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist')], { timeout: 15000 });
  return JSON.parse(stdout);
}
async function running(bundle, run = exec) {
  const { stdout } = await run('/bin/ps', ['-axww', '-o', 'command='], { timeout: 10000 });
  return stdout.split('\n').some(line => line.trimStart().startsWith(bundle + '/Contents/'));
}
async function candidateApps(root, depth = 0) {
  const found = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const file = path.join(root, entry.name);
    if (entry.name.endsWith('.app')) found.push(file);
    else if (depth < 2) found.push(...await candidateApps(file, depth + 1));
  }
  return found;
}
function verifyIdentity(info, installed, pkg) {
  if (info.CFBundleIdentifier !== pkg.bundleId || installed.CFBundleIdentifier !== pkg.bundleId) throw new Error('下载应用的身份与原应用不符');
  const build = String(info.CFBundleVersion || '');
  if (compareVersions(build, pkg.availableBuild) !== 0) throw new Error('下载应用的版本与所选更新不符');
  if (compareVersions(build, String(installed.CFBundleVersion || '')) !== 1) throw new Error('本机版本已变化，请重新扫描');
}
async function replaceBundle(staged, destination, verify, { rename = fs.rename, remove = file => fs.rm(file, { recursive: true, force: true }) } = {}) {
  const backup = destination + '.amu-backup-' + randomUUID();
  await rename(destination, backup);
  try {
    await rename(staged, destination);
    await verify(destination);
  } catch (error) {
    await remove(destination);
    await rename(backup, destination);
    throw error;
  }
  // A failed cleanup must not undo a verified installation. Keep the backup if needed.
  await remove(backup).catch(() => {});
}
class MacInstaller {
  constructor({ run = exec, fetcher = fetch } = {}) { Object.assign(this, { run, fetcher }); }
  async validate(candidate, destination, pkg, signal) {
    const info = await readInfo(candidate, this.run), installed = await readInfo(destination, this.run);
    verifyIdentity(info, installed, pkg);
    const team = async bundle => {
      await this.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { signal, timeout: 120000 });
      const result = await this.run('/usr/bin/codesign', ['-dv', '--verbose=4', bundle], { signal, timeout: 15000 });
      return (result.stderr + result.stdout).match(/^TeamIdentifier=([A-Z0-9]+)$/m)?.[1];
    };
    const oldTeam = await team(destination), newTeam = await team(candidate);
    if (!oldTeam || oldTeam !== newTeam) throw new Error('开发者签名不匹配，请使用原应用更新');
    await this.run('/usr/sbin/spctl', ['--assess', '--type', 'execute', candidate], { signal, timeout: 120000 });
    const executable = path.join(candidate, 'Contents/MacOS', info.CFBundleExecutable || '');
    if (!(await fs.realpath(executable)).startsWith(await fs.realpath(candidate) + path.sep)) throw new Error('应用可执行文件路径无效');
    const { stdout } = await this.run('/usr/bin/lipo', ['-archs', executable], { signal, timeout: 15000 });
    if (!stdout.split(/\s+/).includes('arm64')) throw new Error('安装包不支持 Apple Silicon');
  }
  async update(pkg, { signal, onProgress = () => {} } = {}) {
    if (pkg.updateMode !== 'automatic' || !['zip', 'dmg'].includes(pkg.downloadFormat)) throw new Error('请通过原应用或 App Store 更新');
    const destination = await fs.realpath(pkg.appPath);
    if (!destination.endsWith('.app') || destination !== pkg.appPath) throw new Error('应用路径已变化，请重新扫描');
    if (await running(destination, this.run)) throw new Error('请先退出此应用，然后重试更新');
    await fs.access(path.dirname(destination), fs.constants.W_OK).catch(() => { throw new Error('没有应用目录的写入权限，请通过原应用更新'); });
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'amu-update-'));
    const staged = path.join(path.dirname(destination), `.amu-stage-${randomUUID()}.app`);
    let mounted = false;
    const mount = path.join(temp, 'volume');
    try {
      const archive = path.join(temp, 'update.' + pkg.downloadFormat);
      await download(pkg.downloadUrl, archive, { signal, onProgress, fetcher: this.fetcher });
      onProgress({ stage: '正在校验安装包', percent: null });
      let root = path.join(temp, 'unpacked'); await fs.mkdir(root);
      if (pkg.downloadFormat === 'zip') await unpackZip(archive, root, signal);
      else {
        await fs.mkdir(mount);
        await this.run('/usr/bin/hdiutil', ['attach', archive, '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount], { signal, timeout: 120000 });
        mounted = true; root = mount;
      }
      const matches = [];
      for (const candidate of await candidateApps(root)) {
        if ((await readInfo(candidate, this.run)).CFBundleIdentifier === pkg.bundleId) matches.push(candidate);
      }
      if (matches.length !== 1) throw new Error('安装包中未找到唯一匹配的应用');
      await this.run('/usr/bin/ditto', [matches[0], staged], { signal, timeout: 180000 });
      await this.validate(staged, destination, pkg, signal);
      signal?.throwIfAborted();
      if (await running(destination, this.run)) throw new Error('应用已打开，请退出后重试');
      onProgress({ stage: '正在安装', percent: null });
      // The short atomic replacement and rollback must finish even after cancellation.
      await replaceBundle(staged, destination, async installed => {
        const info = await readInfo(installed, this.run);
        if (info.CFBundleIdentifier !== pkg.bundleId || String(info.CFBundleVersion) !== pkg.availableBuild) throw new Error('安装后版本校验失败');
        await this.run('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed], { timeout: 120000 });
      });
      return { ok: true, code: 'installed-verified' };
    } finally {
      await fs.rm(staged, { recursive: true, force: true }).catch(() => {});
      if (mounted) await this.run('/usr/bin/hdiutil', ['detach', mount], { timeout: 30000 }).catch(() => {});
      // Never recurse into a still-mounted image.
      const mounts = await this.run('/sbin/mount', [], { timeout: 10000 }).catch(() => ({ stdout: mount }));
      if (!mounts.stdout.includes(mount)) await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }
}
module.exports = { MacInstaller, download, unpackZip, safeRelative, verifyIdentity, replaceBundle };
