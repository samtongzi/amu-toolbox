const {
  MAX_CONCURRENT_UPDATES,
  MAX_SCAN_INTERVAL_MINUTES,
  MIN_CONCURRENT_UPDATES,
  MIN_SCAN_INTERVAL_MINUTES
} = require("../config");
const { MAX_PACKAGE_IDENTITY_LENGTH, parsePackageIdentity } = require("../package-identity");

const CHANNELS = [
  "app:get-state",
  "scan:request",
  "updates:start",
  "updates:cancel",
  "updates:retry-failed",
  "updates:open-external",
  "settings:update",
  "logs:clear",
  "packages:show-context-menu",
  "ignored:restore"
];

class IpcController {
  constructor({ ipcMain, windowController, appController, monitor, updateService, logService, startupService, Menu, scanService, client }) {
    this.client = client;
    this.ipcMain = ipcMain;
    this.windowController = windowController;
    this.appController = appController;
    this.monitor = monitor;
    this.updateService = updateService;
    this.logService = logService;
    this.startupService = startupService;
    this.Menu = Menu;
    this.scanService = scanService;
  }

  register() {
    this.ipcMain.handle("updates:open-external", (event, request) => this.guard(event, async () => {
      assertExactKeys(request, ["snapshotId", "packageKeys"]);
      assertIdentifier(request.snapshotId, "snapshotId");
      assertKeyList(request.packageKeys);
      if (request.packageKeys.length !== 1 || !this.client?.openUpdate) throw codedError("invalid-selection", "请选择一个应用更新入口");
      const [pkg] = this.scanService.resolvePackages(request.snapshotId, request.packageKeys);
      await this.client.openUpdate(pkg);
      return { opened: true };
    }));
    this.ipcMain.handle("app:get-state", event => this.guard(event, () => this.appController.getPublicState()));
    this.ipcMain.handle("scan:request", event => this.guard(event, async () => {
      await this.monitor.check("manual");
      return { accepted: true };
    }));
    this.ipcMain.handle("updates:start", (event, request) => this.guard(event, () => {
      assertExactKeys(request, ["snapshotId", "packageKeys"]);
      assertIdentifier(request.snapshotId, "snapshotId");
      assertKeyList(request.packageKeys);
      return this.updateService.start(request);
    }));
    this.ipcMain.handle("updates:cancel", (event, request) => this.guard(event, () => {
      assertExactKeys(request, ["runId"]);
      assertIdentifier(request.runId, "runId");
      return { accepted: this.updateService.cancel(request.runId) };
    }));
    this.ipcMain.handle("updates:retry-failed", (event, request) => this.guard(event, (async () => {
      assertExactKeys(request, ["runId"]);
      assertIdentifier(request.runId, "runId");
      return this.updateService.retryFailed(request.runId);
    })));
    this.ipcMain.handle("settings:update", (event, request) => this.guard(event, async () => {
      validateSettings(request);
      if (request.openAtLogin !== undefined) {
        if (!this.startupService.setEnabled(request.openAtLogin) && request.openAtLogin) {
          throw codedError("startup-unavailable", "开机启动仅在打包版本中可用");
        }
      }
      const state = await this.monitor.updateSettings(request);
      if (request.scanIntervalMinutes !== undefined) this.monitor.setIntervalMinutes(request.scanIntervalMinutes);
      this.appController.broadcast();
      return state.settings;
    }));
    this.ipcMain.handle("packages:show-context-menu", (event, request) => this.guard(event, () => {
      assertExactKeys(request, ["snapshotId", "packageKey"]);
      assertIdentifier(request.snapshotId, "snapshotId");
      assertIdentifier(request.packageKey, "packageKey");
      if (this.updateService.getState().status !== "idle" && !["completed", "cancelled"].includes(this.updateService.getState().status)) return { accepted: false };
      const [pkg] = this.scanService.resolvePackages(request.snapshotId, [request.packageKey]);
      const ignored = this.monitor.isPackageIgnored(pkg);
      const menu = this.Menu.buildFromTemplate([{
        label: ignored ? "取消忽略更新" : "忽略此软件的更新",
        click: async () => {
          if (ignored) await this.monitor.restoreIgnored(require("../package-identity").getPackageIdentity(pkg));
          else await this.monitor.ignorePackage(pkg);
          this.appController.broadcast();
        }
      }]);
      menu.popup({ window: this.windowController.window });
      return { accepted: true };
    }));
    this.ipcMain.handle("ignored:restore", (event, request) => this.guard(event, async () => {
      assertExactKeys(request, ["identity"]);
      const parsed = parsePackageIdentity(request.identity);
      if (!parsed || request.identity.length > MAX_PACKAGE_IDENTITY_LENGTH) throw codedError("invalid-package-identity", "忽略项标识无效");
      await this.monitor.restoreIgnored(parsed.identity);
      this.appController.broadcast();
      return { restored: true };
    }));
    this.ipcMain.handle("logs:clear", event => this.guard(event, () => {
      this.logService.clear();
      this.appController.broadcast();
      return { cleared: true };
    }));
  }

  async guard(event, handler) {
    const expected = this.windowController.window?.webContents;
    if (!expected || event.sender !== expected) throw codedError("unauthorized-ipc", "请求来源无效");
    try {
      return await handler();
    } catch (error) {
      throw sanitizeError(error);
    }
  }

  dispose() {
    for (const channel of CHANNELS) this.ipcMain.removeHandler(channel);
  }
}

function assertExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw codedError("invalid-request", "请求格式无效");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw codedError("invalid-request", "请求包含未知字段");
  }
}

function assertIdentifier(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) throw codedError("invalid-request", `${name} 无效`);
}

function assertKeyList(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) throw codedError("invalid-request", "软件选择无效");
  for (const key of value) assertIdentifier(key, "packageKey");
  if (new Set(value).size !== value.length) throw codedError("invalid-request", "软件选择重复");
}

function validateSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw codedError("invalid-settings", "设置格式无效");
  const allowed = new Set(["scanIntervalMinutes", "notificationsEnabled", "openAtLogin", "maxConcurrentUpdates"]);
  if (Object.keys(value).some(key => !allowed.has(key))) throw codedError("invalid-settings", "设置包含未知字段");
  if ("scanIntervalMinutes" in value && (!Number.isInteger(value.scanIntervalMinutes) || value.scanIntervalMinutes < MIN_SCAN_INTERVAL_MINUTES || value.scanIntervalMinutes > MAX_SCAN_INTERVAL_MINUTES)) {
    throw codedError("invalid-settings", "扫描间隔必须在 15 到 1440 分钟之间");
  }
  if ("maxConcurrentUpdates" in value && (!Number.isInteger(value.maxConcurrentUpdates) || value.maxConcurrentUpdates < MIN_CONCURRENT_UPDATES || value.maxConcurrentUpdates > MAX_CONCURRENT_UPDATES)) {
    throw codedError("invalid-settings", "同时更新数量必须在 1 到 5 之间");
  }
  for (const key of ["notificationsEnabled", "openAtLogin"]) {
    if (key in value && typeof value[key] !== "boolean") throw codedError("invalid-settings", `${key} 必须是布尔值`);
  }
}

function sanitizeError(error) {
  return codedError(error?.code || "operation-failed", error?.message || "操作失败");
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  IpcController,
  assertExactKeys,
  assertIdentifier,
  assertKeyList,
  codedError,
  validateSettings
};
