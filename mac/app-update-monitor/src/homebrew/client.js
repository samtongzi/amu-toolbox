const { MAX_OUTPUT_BYTES, SCAN_TIMEOUT_MS, UPDATE_TIMEOUT_MS, PROBE_TIMEOUT_MS } = require('../config');
const { diagnosticFrom } = require('../winget/client');
const { setTimeout: delay } = require('node:timers/promises');

// Apple Silicon's native prefix. Finder does not inherit the user's shell PATH.
const BREW = '/opt/homebrew/bin/brew';
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9@+_.-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9@+_.-]*){0,2}$/;
function validToken(value) { return typeof value === 'string' && value.length <= 256 && TOKEN.test(value) && !value.split('/').some(p => p === '.' || p === '..'); }
function parseOutdated(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.formulae) || !Array.isArray(data.casks)) throw new Error('Homebrew 返回的列表结构不完整');
  const packages = [], seen = new Set();
  for (const [kind, rows] of [['formula', data.formulae], ['cask', data.casks]]) {
    for (const row of rows) {
      const id = row.full_name || row.name;
      const versions = Array.isArray(row.installed_versions) ? row.installed_versions : [row.installed_versions];
      if (!validToken(id) || !versions.length || !versions.every(v => typeof v === 'string' && v.length > 0) || typeof row.current_version !== 'string' || !row.current_version) {
        throw new Error('Homebrew 返回的软件信息不完整，请更新 Homebrew 后重试');
      }
      const source = `homebrew-${kind}`, key = `${source}:${id}`;
      if (seen.has(key)) throw new Error('Homebrew 返回了重复软件条目');
      seen.add(key);
      packages.push({ id, source, name: row.name || id, installedVersion: versions.join(', '), availableVersion: row.current_version, installedVersionUnknown: false });
    }
  }
  return packages;
}

class HomebrewClient {
  constructor({ runner, executable = BREW, onAvailability = () => {}, wait = (ms, signal) => delay(ms, undefined, { signal }) }) {
    Object.assign(this, { runner, executable, onAvailability, wait });
  }
  run(args, options) {
    return this.runner.run(this.executable, args, { ...options, env: {
      ...process.env, PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ''}`,
      HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_NO_ENV_HINTS: '1',
      HOMEBREW_NO_ANALYTICS: '1', HOMEBREW_NO_COLOR: '1', HOMEBREW_NO_SUDO: '1', HOMEBREW_NO_ASK: '1', NONINTERACTIVE: '1'
    } });
  }
  async probe() {
    const result = await this.run(['--version'], { timeoutMs: PROBE_TIMEOUT_MS, maxOutputBytes: 65536 });
    const state = { available: result.code === 0 && !result.spawnError, version: result.code === 0 ? result.stdout.trim().split('\n')[0] : null, result };
    this.onAvailability(state);
    return state;
  }
  async scan({ signal, reason } = {}) {
    // Re-probe so installing Homebrew while the app is open can recover with Refresh.
    if (!(await this.probe()).available) return { status: 'error', code: 'brew-unavailable', packages: [], warnings: [], diagnostic: '请先安装原生 Homebrew（/opt/homebrew），然后点击刷新。' };
    const warnings = [];
    if (reason !== 'postUpdate') {
      const refresh = await this.run(['update'], { signal, timeoutMs: 30000, maxOutputBytes: MAX_OUTPUT_BYTES });
      const failure = classifyFailure(refresh, 'scan');
      if (failure?.status === 'cancelled' || signal?.aborted) return { ...failure, packages: [], warnings: [] };
      if (failure) warnings.push(`Homebrew 源刷新失败，以下结果基于本地缓存：${failure.diagnostic || failure.code}`);
    }
    const result = await this.run(['outdated', '--json=v2', '--greedy'], { signal, timeoutMs: SCAN_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES });
    const failure = classifyFailure(result, 'scan');
    if (failure) return { ...failure, packages: [], warnings: [] };
    try { return { status: warnings.length ? 'partial' : 'ready', code: 'scan-ready', packages: parseOutdated(result.stdout), warnings, diagnostic: diagnosticFrom(result) }; }
    catch (error) { return { status: 'error', code: 'brew-parse-error', packages: [], warnings: [], diagnostic: error.message }; }
  }
  async update(pkg, { signal } = {}) {
    if (!validToken(pkg?.id) || !['homebrew-formula', 'homebrew-cask'].includes(pkg?.source)) throw new Error('无效的 Homebrew 软件条目');
    const cask = pkg.source === 'homebrew-cask';
    const args = ['upgrade', cask ? '--cask' : '--formula', ...(cask ? ['--greedy', '--no-quit'] : []), pkg.id];
    let result;
    for (const retryDelay of [0, 2000, 5000, 10000]) {
      try { if (retryDelay) await this.wait(retryDelay, signal); }
      catch (error) { if (signal?.aborted) return { ok: false, code: 'update-cancelled' }; throw error; }
      if (signal?.aborted) return { ok: false, code: 'update-cancelled' };
      result = await this.run(args, { signal, timeoutMs: UPDATE_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES });
      if (result.code === 0 || result.cancelled || result.timedOut || !/has already locked|another.*process.*(?:install|upgrad)|operation.*already in progress/i.test(diagnosticFrom(result))) break;
    }
    const failure = classifyFailure(result, 'update');
    return failure ? { ...failure, ok: false } : { ok: true, code: 'updated', diagnostic: diagnosticFrom(result) };
  }
}
function classifyFailure(result, operation) {
  let code;
  if (result.cancelled) code = `${operation}-cancelled`;
  else if (result.timedOut) code = `${operation}-timeout`;
  else if (result.spawnError) code = 'brew-unavailable';
  else if (result.outputTooLarge) code = 'brew-output-too-large';
  else if (result.code !== 0) code = `brew-${operation}-failed`;
  if (!code) return null;
  let diagnostic = diagnosticFrom(result);
  if (/sudo|password|permission denied|not permitted/i.test(diagnostic)) diagnostic = `此更新需要管理员权限，请在终端手动完成后刷新复查。${diagnostic}`;
  return { status: result.cancelled ? 'cancelled' : 'error', code, diagnostic };
}
module.exports = { HomebrewClient, parseOutdated, validToken };
