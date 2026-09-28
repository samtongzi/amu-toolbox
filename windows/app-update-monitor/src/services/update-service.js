const { EventEmitter } = require("events");
const { randomUUID } = require("crypto");
const { getPackageIdentity } = require("../package-identity");
const { setTimeout: delay } = require("timers/promises");
const { verifyPackage } = require("./update-verification");
const {
  DEFAULT_MAX_CONCURRENT_UPDATES,
  MAX_CONCURRENT_UPDATES,
  MIN_CONCURRENT_UPDATES
} = require("../config");

class UpdateService extends EventEmitter {
  constructor({ client, scanService, onLog = () => {}, getConcurrency = () => DEFAULT_MAX_CONCURRENT_UPDATES, isIgnoredPackage = () => false, verificationDelays = [2_000, 5_000], wait = (ms, signal) => delay(ms, undefined, { signal }) }) {
    super();
    this.client = client;
    this.scanService = scanService;
    this.onLog = onLog;
    this.getConcurrency = getConcurrency;
    this.isIgnoredPackage = isIgnoredPackage;
    this.run = null;
    this.runPackages = [];
    this.abortController = null;
    this.verificationDelays = verificationDelays;
    this.wait = wait;
    this.scanService.on("scanned", result => {
      if (["completed", "cancelled"].includes(this.run?.status)) this.reconcileVerification(result, true);
    });
  }

  async start({ snapshotId, packageKeys }) {
    if (this.run && !["completed", "cancelled"].includes(this.run.status)) {
      throw codedError("update-busy", "已有更新任务正在运行");
    }
    const resolvedPackages = this.scanService.resolvePackages(snapshotId, packageKeys);
    const packages = resolvedPackages.filter(pkg => !this.isIgnoredPackage(pkg));
    if (packages.length === 0) throw codedError("no-updatable-selection", "所选软件均已被忽略");
    const concurrency = clampConcurrency(this.getConcurrency());
    const runId = randomUUID();
    this.runPackages = packages.map(pkg => ({ ...pkg }));
    this.abortController = new AbortController();
    this.run = {
      runId,
      snapshotId,
      status: "queued",
      concurrency,
      total: packages.length,
      completed: 0,
      activePackageKeys: [],
      items: packages.map(pkg => ({ packageKey: pkg.packageKey, id: pkg.id, source: pkg.source, name: pkg.name, status: "queued", code: null }))
    };
    this.emit("changed", this.getState());
    void this.process(packages, runId, this.abortController.signal);
    return this.getState();
  }

  async process(packages, runId, signal) {
    this.setStatus("running");
    let nextIndex = 0;
    const workerCount = Math.min(this.run?.concurrency || DEFAULT_MAX_CONCURRENT_UPDATES, packages.length);
    const worker = async () => {
      while (true) {
        if (signal.aborted || this.run?.runId !== runId) return;
        const pkg = packages[nextIndex++];
        if (!pkg) return;
        const item = this.run.items.find(candidate => candidate.packageKey === pkg.packageKey);
        if (!item || item.status !== "queued") continue;
        if (signal.aborted) {
          this.finishItem(pkg.packageKey, "cancelled", "update-cancelled");
          this.run.completed += 1;
          continue;
        }
        this.run.activePackageKeys.push(pkg.packageKey);
        this.setItem(pkg.packageKey, "running", null);
        this.onLog("info", "update", "update-started", `开始更新 ${pkg.name}`, pkg.packageKey);
        let result;
        try {
          result = await this.client.update(pkg, { signal });
        } catch (error) {
          result = { ok: false, code: error.code || "update-failed", diagnostic: error.message };
        }
        this.run.activePackageKeys = this.run.activePackageKeys.filter(key => key !== pkg.packageKey);
        item.commandResult = result;
        if (!result.ok && (signal.aborted || result.code === "update-cancelled")) {
          this.finishItem(pkg.packageKey, "cancelled", result.code, result.diagnostic);
        } else {
          this.setItem(pkg.packageKey, "verifying", result.code);
          this.onLog(result.ok ? "info" : "warn", "update", "update-verifying",
            result.ok ? `正在复查 ${pkg.name}` : `${pkg.name} 更新命令返回异常，正在复查实际结果：${result.diagnostic || result.code}`, pkg.packageKey);
        }
        this.run.completed += 1;
        this.emit("changed", this.getState());
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    if (this.run?.runId !== runId) return;
    for (const item of this.run.items) {
      if (item.status === "queued") this.finishItem(item.packageKey, "cancelled", "update-cancelled");
    }
    this.run.activePackageKeys = [];
    this.setStatus(signal.aborted ? "cancelling" : "verifying");
    for (let attempt = 0; attempt <= this.verificationDelays.length; attempt += 1) {
      if (attempt > 0) {
        if (signal.aborted) break;
        try { await this.wait(this.verificationDelays[attempt - 1], signal); }
        catch (error) { if (signal.aborted) break; throw error; }
        if (signal.aborted) break;
      }
      let verification;
      try {
        verification = await this.scanService.scan({ reason: "postUpdate" });
      } catch (error) {
        this.onLog("warn", "update", error.code || "verification-failed", error.message || "更新后复查失败");
      }
      this.reconcileVerification(verification, false);
      if (!this.run.items.some(item => item.status === "verifying")) break;
    }
    for (const item of this.run.items) {
      if (item.status === "verifying") this.finalizeVerification(item);
    }
    this.setStatus(signal.aborted ? "cancelled" : "completed");
    this.onLog("info", "update", "update-finished", `更新任务完成，处理 ${this.run.completed}/${this.run.total} 项`);
    this.emit("changed", this.getState());
  }

  reconcileVerification(verification, final) {
    for (const item of this.run.items) {
      if (!["verifying", "unverified", "failed", "not-updated"].includes(item.status)) continue;
      const original = this.runPackages.find(pkg => pkg.packageKey === item.packageKey);
      item.verification = verifyPackage(original, verification, this.run.snapshotId);
      if (item.verification === "updated") {
        this.setItem(item.packageKey, "succeeded", "updated", "复查确认已达到目标版本或已无待更新项");
        this.onLog("info", "update", "updated", `${item.name} 更新结果已确认`, item.packageKey);
      } else if (final) {
        this.finalizeVerification(item);
      }
    }
  }

  finalizeVerification(item) {
    // A successful command with stale/unknown metadata is not an installation failure.
    const failed = item.commandResult?.ok === false && item.verification === "pending";
    const diagnostic = failed
      ? item.commandResult.diagnostic || "更新命令未成功，复查显示尚未达到目标版本"
      : item.commandResult?.ok
        ? "更新命令已完成，版本信息尚未确认。可稍后刷新复查，无需立即重复安装。"
        : "更新命令返回异常，但暂时无法确认最终版本。请稍后刷新复查。";
    this.setItem(item.packageKey, failed ? "failed" : "unverified", failed ? item.commandResult.code : "verification-pending", diagnostic);
    this.onLog(failed ? "error" : "warn", "update", item.code, `${item.name}：${diagnostic}`, item.packageKey);
  }

  cancel(runId) {
    if (!this.run || this.run.runId !== runId || ["completed", "cancelled"].includes(this.run.status)) return false;
    this.setStatus("cancelling");
    this.abortController?.abort();
    for (const item of this.run.items) {
      if (item.status === "queued") {
        this.finishItem(item.packageKey, "cancelled", "update-cancelled");
        this.run.completed += 1;
      }
    }
    this.emit("changed", this.getState());
    return true;
  }

  retryFailed(runId) {
    if (!this.run || this.run.runId !== runId || this.run.status !== "completed") throw codedError("retry-unavailable", "没有可重试的更新任务");
    const failedIds = new Set(this.run.items
      .filter(item => item.status === "failed" || item.status === "not-updated")
      .map(item => this.runPackages.find(pkg => pkg.packageKey === item.packageKey))
      .map(getPackageIdentity)
      .filter(Boolean));
    const snapshot = this.scanService.getSnapshot();
    const packageKeys = (snapshot?.packages || [])
      .filter(pkg => failedIds.has(getPackageIdentity(pkg)) && !this.isIgnoredPackage(pkg))
      .map(pkg => pkg.packageKey);
    if (packageKeys.length === 0) throw codedError("retry-unavailable", "最新扫描中没有可重试的失败项");
    return this.start({ snapshotId: snapshot.snapshotId, packageKeys });
  }

  getState() {
    return this.run ? JSON.parse(JSON.stringify(this.run)) : { status: "idle", total: 0, completed: 0, items: [] };
  }

  setStatus(status) {
    if (this.run) this.run.status = status;
    this.emit("changed", this.getState());
  }

  setItem(packageKey, status, code, diagnostic = null) {
    const item = this.run?.items.find(candidate => candidate.packageKey === packageKey);
    if (!item) return;
    item.status = status;
    item.code = code;
    item.diagnostic = diagnostic ? String(diagnostic).slice(0, 500) : null;
    this.emit("changed", this.getState());
  }

  finishItem(packageKey, status, code, diagnostic = null) {
    this.setItem(packageKey, status, code, diagnostic);
    this.run.activePackageKeys = this.run.activePackageKeys.filter(key => key !== packageKey);
  }
}

function clampConcurrency(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return DEFAULT_MAX_CONCURRENT_UPDATES;
  return Math.min(MAX_CONCURRENT_UPDATES, Math.max(MIN_CONCURRENT_UPDATES, numeric));
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { UpdateService, clampConcurrency };
