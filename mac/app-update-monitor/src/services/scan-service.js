const { randomUUID } = require("crypto");
const { EventEmitter } = require("events");
const { cleanOutput } = require("../winget/output-parser");

class ScanService extends EventEmitter {
  constructor({ client, onLog = () => {} }) {
    super();
    this.client = client;
    this.onLog = onLog;
    this.current = null;
    this.snapshot = null;
    this.lastResult = null;
  }

  async scan({ signal, reason = "manual" } = {}) {
    if (this.current) return this.current;
    this.current = this.client.scan({ signal, reason })
      .then(result => {
        this.lastResult = result;
        if (result.status === "ready" || result.status === "partial") {
          this.snapshot = {
            snapshotId: randomUUID(),
            createdAt: new Date().toISOString(),
            packages: result.packages.map(pkg => ({ ...pkg, packageKey: randomUUID() })),
            status: result.status,
            warnings: result.warnings,
            coverage: result.coverage,
            installations: result.installations,
            completeSources: result.completeSources
          };
        } else if (this.snapshot) {
          this.snapshot = { ...this.snapshot, status: "stale" };
        }
        this.onLog(result.status === "error" ? "error" : result.status === "partial" || result.status === "cancelled" ? "warn" : "info", "scan", result.code, scanMessage(result, reason));
        const completed = { ...result, snapshot: this.snapshot };
        this.emit("scanned", completed);
        return completed;
      })
      .finally(() => {
        this.current = null;
      });
    return this.current;
  }

  getSnapshot() {
    return this.snapshot ? clone(this.snapshot) : null;
  }

  resolvePackages(snapshotId, packageKeys) {
    if (!this.snapshot || this.snapshot.snapshotId !== snapshotId || this.snapshot.status === "stale") {
      const error = new Error("扫描结果已过期，请先刷新");
      error.code = "stale-snapshot";
      throw error;
    }
    if (!Array.isArray(packageKeys) || packageKeys.length === 0 || packageKeys.length > 500) {
      const error = new Error("请选择要更新的软件");
      error.code = "invalid-selection";
      throw error;
    }
    const keys = new Set(packageKeys);
    if (keys.size !== packageKeys.length) {
      const error = new Error("软件选择重复");
      error.code = "duplicate-selection";
      throw error;
    }
    const packages = this.snapshot.packages.filter(pkg => keys.has(pkg.packageKey));
    if (packages.length !== packageKeys.length) {
      const error = new Error("软件选择已失效，请先刷新");
      error.code = "invalid-selection";
      throw error;
    }
    return packages.map(({ packageKey, ...pkg }) => ({ ...pkg, packageKey }));
  }
}

function scanMessage(result, reason) {
  const labels = { startup: "启动扫描", scheduled: "定时扫描", resume: "恢复后扫描", manual: "手动扫描", postUpdate: "更新后复查" };
  if (result.status === "error" || result.status === "cancelled") return `${labels[reason] || "扫描"}：${scanFailureMessage(result)}`;
  if (result.status === "ready" && result.packages.length === 0) return `${labels[reason] || "扫描"}完成，没有可更新应用`;
  return `${labels[reason] || "扫描"}完成，发现 ${result.packages.length} 个可更新应用（${result.status}）`;
}

function scanFailureMessage(result) {
  const messages = {
    "brew-unavailable": "Homebrew 不可用，请安装原生 Homebrew 后刷新",
    "brew-scan-failed": "Homebrew 扫描失败，请查看以下详情",
    "brew-parse-error": "Homebrew 返回的应用列表无法解析",
    "brew-output-too-large": "Homebrew 输出过大，扫描未完成",
    "scan-timeout": "扫描超时，请检查网络连接后重新扫描",
    "scan-cancelled": "扫描已取消，可重新扫描",
    "source-error": "软件源访问失败，请检查网络连接后重新扫描",
    "parse-error": "无法解析 winget 返回的应用列表",
    "winget-unavailable": "无法启动 winget，请检查 Windows 程序包管理器",
    "output-too-large": "winget 输出超出限制，扫描未完成",
    "multiple-matches": "winget 返回多个匹配项，无法确定扫描结果"
  };
  const message = messages[result?.code] || "winget 扫描未成功";
  const code = result?.exitCode?.hex ? `（退出码 ${result.exitCode.hex}）` : "";
  const detail = cleanOutput(result?.diagnostic).trim().slice(-600);
  return `${message}${code}${detail ? `：${detail}` : ""}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { ScanService, scanMessage, scanFailureMessage };
