class MacClient {
  constructor({ scanner, shell, installer }) { Object.assign(this, { scanner, shell, installer }); }
  async probe() {
    return { available: true, version: '官网 / App Store' };
  }
  async scan(options = {}) {
    const apps = await this.scanner.scan(options);
    if (options.signal?.aborted) return { status: 'cancelled', code: 'scan-cancelled', packages: [], warnings: [] };
    // A failed source supplies no update result; keep its diagnostics out of the user interface.
    return { status: 'ready', code: 'mac-scan-ready', packages: apps.packages,
      warnings: [], installations: apps.installations, completeSources: [], diagnostic: '' };
  }
  update(pkg, options) {
    if (pkg.updateMode !== 'automatic' || !this.installer) throw new Error('请在原应用或 App Store 内完成更新');
    return this.installer.update(pkg, options);
  }
  async openUpdate(pkg) {
    if (pkg.updateMode !== 'external') throw new Error('该项目支持直接更新');
    if (pkg.source === 'app-store') return this.shell.openExternal('macappstore://showUpdatesPage');
    if (!['sparkle', 'sublime-text', 'claude'].includes(pkg.source) || !pkg.appPath?.endsWith('.app')) throw new Error('更新入口无效');
    const error = await this.shell.openPath(pkg.appPath);
    if (error) throw new Error(error);
  }
}
module.exports = { MacClient };
