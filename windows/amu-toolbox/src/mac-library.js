const fs = require('node:fs/promises');
const path = require('node:path');
const { Library, inside } = require('./library');

class MacLibrary extends Library {
  constructor(options) {
    super(options);
    for (const item of this.catalog) {
      if (!item.file.endsWith('.zip') || !item.bundleName?.endsWith('.app') || path.basename(item.bundleName) !== item.bundleName || !item.bundleExecutable || path.basename(item.bundleExecutable) !== item.bundleExecutable || !/^[a-zA-Z0-9.-]+$/.test(item.bundleId || '')) throw new Error('Mac 工具目录配置无效');
    }
  }
  executable(id) { return inside(this.directory(id), this.app(id).bundleName); }
  async installed(item) {
    try {
      await this.safeDirectories(this.installRoot, this.executable(item.id));
      const metadata = JSON.parse(await fs.readFile(inside(this.directory(item.id), 'installed.json'), 'utf8'));
      const binary = await fs.lstat(inside(this.executable(item.id), 'Contents', 'MacOS', item.bundleExecutable));
      if (metadata.id !== item.id || metadata.bundleId !== item.bundleId || typeof metadata.version !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.sha256 || '') || !binary.isFile() || binary.isSymbolicLink()) return null;
      return { version: metadata.version, size: metadata.size, installedAt: metadata.installedAt, path: this.executable(item.id), needsUpdate: metadata.version !== item.version };
    } catch { return null; }
  }
  async install(id) {
    const item = this.app(id);
    return this.task(item, 'install', async job => {
      const directory = this.directory(id);
      await this.safeDirectories(this.installRoot, directory);
      await fs.mkdir(this.installRoot, { recursive: true });
      if (this.launching.has(id) || await this.platform.isRunning(this.executable(id))) throw new Error('请先从顶部菜单栏退出这个工具，再安装或更新');
      const existing = await this.installed(item);
      const exists = await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (exists && !existing) throw new Error('安装目录中有无法识别的文件，请先检查');
      const stage = inside(this.installRoot, `.${id}-${job.id}.stage`), backup = inside(this.installRoot, `.${id}-${job.id}.backup`);
      let movedOld = false, committed = false;
      try {
        await fs.mkdir(stage);
        const archive = inside(stage, item.file);
        await this.copyVerified(item, archive, job);
        job.stage = '解压并验证应用签名'; this.changed();
        await this.platform.extract(archive, stage, item, job.controller.signal);
        await fs.rm(archive);
        await fs.writeFile(inside(stage, 'installed.json'), JSON.stringify({ id, bundleId: item.bundleId, version: item.version, size: item.size, sha256: item.sha256, installedAt: new Date().toISOString() }));
        job.controller.signal.throwIfAborted();
        job.cancellable = false; job.stage = '完成安装'; this.changed();
        if (existing) { await fs.rename(directory, backup); movedOld = true; }
        await fs.rename(stage, directory); committed = true;
      } catch (error) {
        if (committed) { await this.safeDirectories(this.installRoot, directory); await fs.rm(directory, { recursive: true, force: true }); }
        if (movedOld) await fs.rename(backup, directory);
        throw error;
      } finally {
        await this.safeDirectories(this.installRoot, stage);
        await fs.rm(stage, { recursive: true, force: true });
      }
      if (movedOld) { await this.safeDirectories(this.installRoot, backup); await fs.rm(backup, { recursive: true, force: true }); }
    });
  }
  async uninstall(id) {
    const item = this.app(id);
    return this.task(item, 'uninstall', async job => {
      const existing = await this.installed(item);
      if (!existing) throw new Error('这个工具尚未由阿木工具箱安装');
      if (this.launching.has(id) || await this.platform.isRunning(this.executable(id))) throw new Error('请先从顶部菜单栏退出这个工具，再卸载');
      job.stage = '关闭登录启动并移除应用'; this.changed();
      await this.platform.removeOwnedStartup(item.startupName, this.executable(id), { ...item, version: existing.version });
      await this.safeDirectories(this.installRoot, this.directory(id));
      await fs.rm(this.directory(id), { recursive: true });
    });
  }
}
module.exports = { MacLibrary };
