const fs = require("node:fs/promises");
const { createReadStream, createWriteStream } = require("node:fs");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const path = require("node:path");
const crypto = require("node:crypto");

function inside(root, ...parts) {
  const target = path.resolve(root, ...parts);
  const relative = path.relative(path.resolve(root), target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error("无效的工具路径");
  return target;
}

class Library {
  constructor({ catalog, packageRoot, installRoot, shortcutsRoot, shell, platform, onChange = () => {} }) {
    Object.assign(this, { catalog, packageRoot, installRoot, shortcutsRoot, shell, platform, onChange });
    this.jobs = [];
    this.active = null;
    this.launching = new Set();
    for (const app of catalog) {
      if (!/^[a-z0-9-]+$/.test(app.id) || path.basename(app.file) !== app.file || !/^[a-f0-9]{64}$/.test(app.sha256)) throw new Error("工具目录配置无效");
    }
  }

  app(id) {
    const app = this.catalog.find(item => item.id === id);
    if (!app) throw new Error("未找到这个工具");
    return app;
  }
  directory(id) { this.app(id); return inside(this.installRoot, id); }
  executable(id) { return inside(this.directory(id), this.app(id).file); }
  shortcut(id) { return inside(this.shortcutsRoot, `${this.app(id).name}.lnk`); }

  async safeDirectories(root, target) {
    // Refuse junctions and symbolic links before writes or recursive removal.
    const relative = path.relative(path.resolve(root), path.resolve(target));
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("操作超出了工具安装目录");
    let cursor = path.resolve(root);
    for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
      if (part) cursor = path.join(cursor, part);
      const stat = await fs.lstat(cursor).catch(error => { if (error.code !== "ENOENT") throw error; });
      if (stat?.isSymbolicLink()) throw new Error("安装目录包含链接，请改用普通目录");
      if (stat && !stat.isDirectory()) throw new Error("安装目录被其他文件占用");
    }
  }

  async installed(app) {
    try {
      await this.safeDirectories(this.installRoot, this.directory(app.id));
      const metadata = JSON.parse(await fs.readFile(inside(this.directory(app.id), "installed.json"), "utf8"));
      const file = await fs.lstat(this.executable(app.id));
      if (metadata.id !== app.id || typeof metadata.version !== "string" || !/^[a-f0-9]{64}$/.test(metadata.sha256 || "") || !file.isFile() || file.isSymbolicLink() || file.size !== metadata.size) return null;
      return { version: metadata.version, size: file.size, installedAt: metadata.installedAt, path: this.executable(app.id), needsUpdate: metadata.version !== app.version };
    } catch { return null; }
  }

  async snapshot() {
    const apps = await Promise.all(this.catalog.map(async app => {
      let available = false;
      try { available = (await fs.stat(inside(this.packageRoot, app.file))).size === app.size; } catch {}
      return { ...app, available, installed: await this.installed(app), launching: this.launching.has(app.id) };
    }));
    return { platform: process.platform === "darwin" ? "macOS · Apple Silicon" : "Windows", apps, jobs: this.jobs.map(({ controller, ...job }) => ({ ...job })), busy: !!this.active };
  }

  changed() { this.onChange(); }
  cancel() { if (this.active?.cancellable) this.active.controller.abort(); }

  async task(app, type, work) {
    if (this.active) throw new Error("请等待当前任务完成，或先取消当前任务");
    const job = { id: crypto.randomUUID(), appId: app.id, name: app.name, type, status: "running", stage: "准备中", percent: 0,
      startedAt: new Date().toISOString(), cancellable: type !== "uninstall", controller: new AbortController() };
    this.active = job;
    this.jobs.unshift(job);
    this.jobs.length = Math.min(this.jobs.length, 30);
    this.changed();
    try {
      const result = await work(job);
      job.status = "completed"; job.percent = 100; job.stage = "已完成";
      return { cancelled: false, ...result };
    } catch (error) {
      job.status = error.name === "AbortError" ? "cancelled" : "failed";
      job.stage = job.status === "cancelled" ? "已取消" : "失败";
      job.error = job.status === "cancelled" ? "任务已取消" : error.message;
      if (job.status !== "cancelled") throw error;
      return { cancelled: true };
    } finally {
      job.cancellable = false; job.finishedAt = new Date().toISOString(); this.active = null; this.changed();
    }
  }

  async copyVerified(app, destination, job) {
    const hash = crypto.createHash("sha256");
    let bytes = 0, emitted = 0;
    job.stage = "复制并校验文件";
    const meter = new Transform({ transform: (chunk, _encoding, callback) => {
      bytes += chunk.length; hash.update(chunk);
      job.percent = Math.min(96, Math.round(bytes / app.size * 96));
      if (Date.now() - emitted > 100) { emitted = Date.now(); this.changed(); }
      callback(null, chunk);
    } });
    await pipeline(createReadStream(inside(this.packageRoot, app.file)), meter,
      createWriteStream(destination, { flags: "wx" }), { signal: job.controller.signal });
    if (bytes !== app.size || hash.digest("hex") !== app.sha256) throw new Error("安装包校验失败，请重新获取完整的阿木工具箱");
    job.controller.signal.throwIfAborted();
  }

  async install(id) {
    const app = this.app(id);
    return this.task(app, "install", async job => {
      await this.safeDirectories(this.installRoot, this.directory(id));
      await fs.mkdir(this.installRoot, { recursive: true });
      if (this.launching.has(id) || await this.platform.isRunning(this.executable(id))) throw new Error("工具正在运行，请先从它的托盘菜单退出，再安装或更新");
      const directory = this.directory(id);
      const existing = await this.installed(app);
      const exists = await fs.lstat(directory).catch(error => { if (error.code !== "ENOENT") throw error; });
      if (exists && !existing) throw new Error("目标目录中有无法识别的文件，请先在安装目录中检查");
      const stage = inside(this.installRoot, `.${id}-${job.id}.stage`);
      const backup = inside(this.installRoot, `.${id}-${job.id}.backup`);
      let movedOld = false, committed = false;
      try {
        await fs.mkdir(stage);
        await this.copyVerified(app, inside(stage, app.file), job);
        await fs.writeFile(inside(stage, "installed.json"), JSON.stringify({ id, version: app.version, size: app.size, sha256: app.sha256, installedAt: new Date().toISOString() }));
        job.controller.signal.throwIfAborted();
        job.cancellable = false; job.stage = "完成安装"; this.changed();
        if (existing) { await fs.rename(directory, backup); movedOld = true; }
        await fs.rename(stage, directory); committed = true;
        await fs.mkdir(this.shortcutsRoot, { recursive: true });
        if (!this.shell.writeShortcutLink(this.shortcut(id), "create", { target: this.executable(id), cwd: directory, description: app.description, icon: this.executable(id), iconIndex: 0 })) throw new Error("无法创建开始菜单快捷方式");
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

  async exportPackage(id, destination) {
    const app = this.app(id);
    if (path.resolve(destination) === path.resolve(inside(this.packageRoot, app.file))) throw new Error("请选择其他保存位置");
    const rel = path.relative(this.installRoot, path.resolve(destination));
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error("请把便携版保存到工具安装目录以外的位置");
    return this.task(app, "export", async job => {
      const temporary = `${destination}.${job.id}.part`;
      try {
        await this.copyVerified(app, temporary, job);
        job.cancellable = false; job.stage = "保存文件"; this.changed();
        await fs.rename(temporary, destination);
        job.path = destination;
      } finally { await fs.rm(temporary, { force: true }); }
    });
  }

  async uninstall(id) {
    const app = this.app(id);
    return this.task(app, "uninstall", async job => {
      if (!await this.installed(app)) throw new Error("这个工具尚未由阿木工具箱安装");
      if (this.launching.has(id) || await this.platform.isRunning(this.executable(id))) throw new Error("工具正在运行，请先从它的托盘菜单退出，再卸载");
      job.stage = "移除应用文件"; this.changed();
      await this.platform.removeOwnedStartup(app.startupName, this.executable(id));
      const shortcut = this.shortcut(id);
      try {
        const details = this.shell.readShortcutLink(shortcut);
        if (path.resolve(details.target).toLowerCase() === path.resolve(this.executable(id)).toLowerCase()) await fs.rm(shortcut, { force: true });
      } catch (error) { if (error.code && error.code !== "ENOENT") throw error; }
      await this.safeDirectories(this.installRoot, this.directory(id));
      await fs.rm(this.directory(id), { recursive: true });
    });
  }

  async launch(id) {
    const app = this.app(id);
    if (this.launching.has(id)) return;
    if (this.active?.appId === id) throw new Error("请等待当前任务完成后再打开工具");
    if (!await this.installed(app)) throw new Error("请先安装这个工具");
    if (this.active?.appId === id) throw new Error("请等待当前任务完成后再打开工具");
    this.launching.add(id); this.changed();
    try { await this.platform.launch(this.executable(id)); }
    finally { this.launching.delete(id); this.changed(); }
  }
}

module.exports = { Library, inside };
