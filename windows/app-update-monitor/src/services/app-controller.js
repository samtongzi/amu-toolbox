const { EventEmitter } = require("events");

class AppController extends EventEmitter {
  constructor({ scanService, updateService, monitor, logService, winget }) {
    super();
    this.scanService = scanService;
    this.updateService = updateService;
    this.monitor = monitor;
    this.logService = logService;
    this.winget = winget;
    this.revision = 0;
    this.runtime = { scanStatus: "idle", lastScanResult: null };
    updateService.on("changed", () => this.broadcast());
    logService.on("entry", entry => this.emit("log", entry));
  }

  setRuntime(patch) {
    this.runtime = { ...this.runtime, ...patch };
    this.broadcast();
  }

  broadcast() {
    this.revision += 1;
    this.emit("state", this.getPublicState());
  }

  getPublicState() {
    const snapshot = this.scanService.getSnapshot();
    const packages = snapshot ? this.monitor.filterIgnoredPackages(snapshot.packages) : [];
    return {
      revision: this.revision,
      backend: this.winget.backend || "winget",
      winget: { available: this.winget.available, version: this.winget.version },
      runtime: {
        scanStatus: this.runtime.scanStatus,
        error: this.runtime.error || null,
        lastResultCode: this.runtime.lastScanResult?.code || null
      },
      persisted: this.monitor.getState(),
      snapshot: snapshot ? {
        snapshotId: snapshot.snapshotId,
        createdAt: snapshot.createdAt,
        status: snapshot.status,
        warnings: snapshot.warnings,
        packages: packages.map(({ id, source, ...pkg }) => ({ ...pkg, id, source }))
      } : null,
      update: this.updateService.getState(),
      logs: this.logService.list()
    };
  }
}

module.exports = { AppController };
