const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

function cleanEnvironment() {
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'PORTABLE_EXECUTABLE_FILE', 'PORTABLE_EXECUTABLE_DIR', 'PORTABLE_EXECUTABLE_APP_FILENAME']) delete env[key];
  return env;
}
async function isRunning(bundle) {
  const { stdout } = await exec('/bin/ps', ['-axww', '-o', 'command='], { timeout: 10000 });
  const prefix = `${bundle}/Contents/`;
  return stdout.split('\n').some(line => line.trimStart().startsWith(prefix));
}
async function launch(bundle) { await exec('/usr/bin/open', ['-a', bundle], { env: cleanEnvironment(), timeout: 15000 }); }
function validateEntries(list, bundleName) {
  const entries = list.split('\n').filter(Boolean);
  if (!entries.length || entries.some(entry => entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..') || !(entry === bundleName || entry.startsWith(`${bundleName}/`) || entry.startsWith('__MACOSX/')))) throw new Error('安装包中的应用路径无效');
}
async function extract(archive, destination, item, signal) {
  const { stdout } = await exec('/usr/bin/unzip', ['-Z1', archive], { signal, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  validateEntries(stdout, item.bundleName);
  // ditto retains Electron framework symlinks and executable permissions.
  await exec('/usr/bin/ditto', ['-x', '-k', archive, destination], { signal, timeout: 120000 });
  await verifyBundle(path.join(destination, item.bundleName), item, signal);
}
async function verifyBundle(bundle, item, signal) {
  const stat = await fs.lstat(bundle);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('安装包缺少有效应用');
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  const read = async key => (await exec('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { signal, timeout: 10000 })).stdout.trim();
  if (await read('CFBundleIdentifier') !== item.bundleId || await read('CFBundleExecutable') !== item.bundleExecutable || await read('CFBundleShortVersionString') !== item.version) throw new Error('应用标识或版本校验失败');
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { signal, timeout: 60000 });
  const executable = path.join(bundle, 'Contents', 'MacOS', item.bundleExecutable);
  const { stdout: architecture } = await exec('/usr/bin/lipo', ['-archs', executable], { signal, timeout: 10000 });
  if (architecture.trim() !== 'arm64') throw new Error('工具安装包不是 Apple Silicon 专用版本');
}
async function removeOwnedStartup(_name, bundle, item) {
  // Ask this exact signed app to remove its own login item, without starting monitoring.
  await verifyBundle(bundle, item);
  await exec(path.join(bundle, 'Contents', 'MacOS', item.bundleExecutable), ['--amu-disable-startup'], { env: cleanEnvironment(), timeout: 20000 });
}
module.exports = { isRunning, launch, extract, verifyBundle, removeOwnedStartup, validateEntries };
