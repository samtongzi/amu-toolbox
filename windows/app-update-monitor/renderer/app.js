"use strict";

const ui = {
  wingetStatus: document.getElementById("wingetStatus"),
  lastScanTime: document.getElementById("lastScanTime"),
  packageCount: document.getElementById("packageCount"),
  selectionSummary: document.getElementById("selectionSummary"),
  refreshButton: document.getElementById("refreshButton"),
  updateSelectedButton: document.getElementById("updateSelectedButton"),
  updateAllButton: document.getElementById("updateAllButton"),
  cancelButton: document.getElementById("cancelButton"),
  stateNotice: document.getElementById("stateNotice"),
  noticeTitle: document.getElementById("noticeTitle"),
  noticeDetail: document.getElementById("noticeDetail"),
  noticeRetryButton: document.getElementById("noticeRetryButton"),
  executionTrack: document.getElementById("executionTrack"),
  trackLabel: document.getElementById("trackLabel"),
  trackCurrent: document.getElementById("trackCurrent"),
  trackCount: document.getElementById("trackCount"),
  trackSummary: document.getElementById("trackSummary"),
  progressRail: document.getElementById("progressRail"),
  progressBar: document.getElementById("progressBar"),
  retryFailedButton: document.getElementById("retryFailedButton"),
  selectAllCheckbox: document.getElementById("selectAllCheckbox"),
  packageTableBody: document.getElementById("packageTableBody"),
  tablePlaceholder: document.getElementById("tablePlaceholder"),
  placeholderTitle: document.getElementById("placeholderTitle"),
  placeholderDetail: document.getElementById("placeholderDetail"),
  logCount: document.getElementById("logCount"),
  logList: document.getElementById("logList"),
  clearLogsButton: document.getElementById("clearLogsButton"),
  settingsForm: document.getElementById("settingsForm"),
  scanInterval: document.getElementById("scanInterval"),
  notificationsEnabled: document.getElementById("notificationsEnabled"),
  openAtLogin: document.getElementById("openAtLogin"),
  maxConcurrentUpdates: document.getElementById("maxConcurrentUpdates"),
  ignoredCount: document.getElementById("ignoredCount"),
  ignoredList: document.getElementById("ignoredList"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
  settingsSaveState: document.getElementById("settingsSaveState"),
  toast: document.getElementById("toast")
};

const model = {
  state: null,
  selectedKeys: new Set(),
  logs: [],
  logIds: new Set(),
  settingsInitialized: false,
  settingsDirty: false,
  busyAction: null,
  toastTimer: null
};

const ACTIVE_UPDATE_STATUSES = new Set(["queued", "running", "verifying", "cancelling"]);
const FINAL_UPDATE_STATUSES = new Set(["completed", "cancelled"]);
const PACKAGE_STATUS_LABELS = {
  queued: "等待中",
  running: "更新中",
  verifying: "复查中",
  succeeded: "已更新",
  unverified: "待确认",
  failed: "失败",
  "not-updated": "未更新",
  cancelled: "已取消"
};
const LOG_LEVEL_LABELS = {
  error: "错误",
  warn: "警告",
  warning: "警告",
  info: "信息",
  debug: "调试"
};

function setText(element, value) {
  element.textContent = value == null ? "" : String(value);
}

function formatDateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function errorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}

function isUpdateActive(update) {
  return ACTIVE_UPDATE_STATUSES.has(update?.status);
}

function ignoredPackages() {
  return Array.isArray(model.state?.persisted?.ignoredPackages) ? model.state.persisted.ignoredPackages : [];
}

function packageIdentity(pkg) {
  return `${String(pkg?.source || "").trim().toLowerCase()}\0${String(pkg?.id || "").trim().toLowerCase()}`;
}

function isIgnored(pkg) {
  const identity = packageIdentity(pkg);
  return ignoredPackages().some(item => item.identity === identity);
}

function currentPackages() {
  return (Array.isArray(model.state?.snapshot?.packages) ? model.state.snapshot.packages : []).filter(pkg => !isIgnored(pkg));
}

function canUseSnapshot() {
  const snapshotStatus = model.state?.snapshot?.status;
  return model.state?.winget?.available === true
    && (snapshotStatus === "ready" || snapshotStatus === "partial")
    && !isUpdateActive(model.state?.update);
}

function getUpdateItem(packageKey) {
  const items = Array.isArray(model.state?.update?.items) ? model.state.update.items : [];
  const pkg = currentPackages().find(item => item.packageKey === packageKey);
  return items.find(item => item.packageKey === packageKey
    || (pkg && item.id && item.source && packageIdentity(item) === packageIdentity(pkg))) || null;
}

function reconcileSelection() {
  const validKeys = new Set(currentPackages().map(pkg => pkg.packageKey));
  for (const key of model.selectedKeys) {
    if (!validKeys.has(key)) model.selectedKeys.delete(key);
  }
}

function setNotice(kind, title, detail, retry = false) {
  ui.stateNotice.className = `notice is-${kind}`;
  setText(ui.noticeTitle, title);
  setText(ui.noticeDetail, detail);
  setText(ui.noticeRetryButton, "刷新复查");
  ui.noticeRetryButton.hidden = !retry;
}

function renderWinget() {
  const mac = model.state?.backend === "homebrew";
  document.body.classList.toggle("mac", mac);
  document.querySelector(".readout-label").textContent = mac ? "HOMEBREW" : "WINGET";
  const winget = model.state?.winget;
  ui.wingetStatus.className = "status-pill";
  if (!model.state) {
    ui.wingetStatus.classList.add("is-loading");
    setText(ui.wingetStatus, "检测中");
    return;
  }
  if (winget?.available) {
    ui.wingetStatus.classList.add("is-ready");
    setText(ui.wingetStatus, winget.version || "可用");
  } else {
    ui.wingetStatus.classList.add("is-error");
    setText(ui.wingetStatus, "不可用");
  }
}

function renderNotice() {
  const state = model.state;
  if (!state) {
    setNotice("loading", "正在加载应用状态", "正在连接本机维护服务…");
    return;
  }

  if (!state.winget?.available) {
    setNotice("error", state.backend === "homebrew" ? "Homebrew 不可用" : "winget 不可用", state.backend === "homebrew" ? "请先安装 Apple Silicon 版 Homebrew（/opt/homebrew），再点击刷新。" : "请安装或修复 Windows 程序包管理器后重试。", true);
    return;
  }

  const update = state.update || {};
  const failedCount = Array.isArray(update.items)
    ? update.items.filter(item => item.status === "failed" || item.status === "not-updated").length
    : 0;
  const unverifiedCount = (update.items || []).filter(item => item.status === "unverified").length;
  if (isUpdateActive(update)) {
    const labels = {
      queued: ["更新任务已排队", "正在准备更新所选应用。"],
      running: ["正在更新应用", `已完成 ${update.completed || 0}/${update.total || 0} 项。`],
      verifying: ["正在复查更新结果", "更新命令已完成，正在重新扫描应用版本。"],
      cancelling: ["正在取消更新", "正在停止所有进行中的更新和等待项。"]
    };
    const copy = labels[update.status] || labels.running;
    setNotice("loading", copy[0], copy[1]);
    return;
  }
  if (update.status === "cancelled") {
    setNotice("warning", "更新任务已取消", `已处理 ${update.completed || 0}/${update.total || 0} 项，可重新选择后继续。`);
    return;
  }
  if (state.runtime?.scanStatus === "scanning") {
    setNotice("loading", "正在扫描可用更新", "正在刷新列表并复查上次更新结果。");
    return;
  }
  if (update.status === "completed" && failedCount > 0) {
    setNotice("error", "部分应用更新失败", `${failedCount} 项未完成${unverifiedCount ? `，另有 ${unverifiedCount} 项待确认` : ""}，可在执行轨道中重试失败项。`);
    return;
  }
  if (update.status === "completed" && unverifiedCount > 0) {
    setNotice("warning", "部分更新结果待确认", `${unverifiedCount} 项尚未确认最终版本，可能仍在收尾或版本信息尚未刷新。请稍后刷新复查。`, true);
    return;
  }

  const runtimeStatus = state.runtime?.scanStatus;
  const snapshot = state.snapshot;
  if (runtimeStatus === "scanning") {
    setNotice("loading", "正在扫描可用更新", "正在检查已安装应用和软件源。取消前请等待扫描完成。" );
    return;
  }
  if (snapshot?.status === "stale") {
    setNotice("warning", "扫描结果已过期", `${state.runtime?.error ? `${state.runtime.error}。` : ""}下面显示的是上次成功结果，刷新后才能执行更新。`, true);
    return;
  }
  if (runtimeStatus === "error" || runtimeStatus === "cancelled") {
    const title = runtimeStatus === "cancelled" ? "扫描已取消" : "扫描失败";
    setNotice("error", title, state.runtime?.error || "未能取得最新应用列表，请检查日志后重试。", true);
    return;
  }
  if (!snapshot) {
    setNotice("loading", "等待首次扫描", "正在准备应用扫描。" );
    return;
  }
  if (snapshot.status === "partial") {
    const warningCount = Array.isArray(snapshot.warnings) ? snapshot.warnings.length : 0;
    setNotice("warning", "扫描结果不完整", `已读取 ${snapshot.packages?.length || 0} 项更新，另有 ${warningCount} 条数据未能解析。`);
    return;
  }
  const count = currentPackages().length;
  if (count === 0) {
    const ignoredCount = ignoredPackages().length;
    setNotice("ready", "所有应用均为最新", ignoredCount ? `本次扫描没有可操作更新，已忽略 ${ignoredCount} 项。` : "本次扫描没有发现可用更新。" );
    return;
  }
  setNotice("ready", "扫描完成", `发现 ${count} 个可更新应用。`);
}

function renderActions() {
  const state = model.state;
  const packages = currentPackages();
  const updateActive = isUpdateActive(state?.update);
  const usable = canUseSnapshot();
  const scanning = state?.runtime?.scanStatus === "scanning";

  ui.refreshButton.disabled = !state || scanning || updateActive || model.busyAction === "refresh";
  ui.updateSelectedButton.disabled = !usable || model.selectedKeys.size === 0 || Boolean(model.busyAction);
  ui.updateAllButton.disabled = !usable || packages.length === 0 || Boolean(model.busyAction);
  ui.cancelButton.hidden = !updateActive;
  ui.cancelButton.disabled = state?.update?.status === "cancelling" || model.busyAction === "cancel";
  setText(ui.refreshButton, model.busyAction === "refresh" ? "刷新中…" : "刷新");
  setText(ui.updateSelectedButton, model.busyAction === "selected" ? "正在提交…" : "更新选中项");
  setText(ui.updateAllButton, model.busyAction === "all" ? "正在提交…" : "更新全部");
  setText(ui.cancelButton, state?.update?.status === "cancelling" ? "取消中…" : "取消");

  setText(ui.packageCount, packages.length || "0");
  setText(ui.selectionSummary, model.selectedKeys.size ? `已选择 ${model.selectedKeys.size} 项` : "未选择");
  ui.selectAllCheckbox.disabled = !usable || packages.length === 0;
  ui.selectAllCheckbox.checked = packages.length > 0 && model.selectedKeys.size === packages.length;
  ui.selectAllCheckbox.indeterminate = model.selectedKeys.size > 0 && model.selectedKeys.size < packages.length;
}

function createCell(className) {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  return cell;
}

function createCheckbox(packageKey, name, enabled) {
  const label = document.createElement("label");
  label.className = "checkbox-wrap";
  label.title = `选择 ${name}`;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = model.selectedKeys.has(packageKey);
  input.disabled = !enabled;
  input.setAttribute("aria-label", `选择 ${name}`);
  input.addEventListener("change", () => {
    if (input.checked) model.selectedKeys.add(packageKey);
    else model.selectedKeys.delete(packageKey);
    renderTable();
    renderActions();
  });
  const box = document.createElement("span");
  box.setAttribute("aria-hidden", "true");
  label.append(input, box);
  return label;
}

function renderTable() {
  ui.packageTableBody.replaceChildren();
  const packages = currentPackages();
  const enabled = canUseSnapshot();
  const fragment = document.createDocumentFragment();

  for (const pkg of packages) {
    const row = document.createElement("tr");
    row.title = "右键可忽略此软件的更新";
    row.addEventListener("contextmenu", event => {
      event.preventDefault();
      if (!model.state?.snapshot?.snapshotId || !window.appApi?.showPackageContextMenu) return;
      void window.appApi.showPackageContextMenu(model.state.snapshot.snapshotId, pkg.packageKey)
        .catch(error => showToast(errorMessage(error, "无法打开软件菜单。"), true));
    });
    if (model.selectedKeys.has(pkg.packageKey)) row.classList.add("is-selected");
    if (!enabled) row.classList.add("is-disabled");

    const selectionCell = createCell("selection-column");
    selectionCell.append(createCheckbox(pkg.packageKey, pkg.name || pkg.id || "应用", enabled));

    const appCell = createCell("app-cell");
    const appName = document.createElement("span");
    appName.className = "app-name";
    setText(appName, pkg.name || pkg.id || "未知应用");
    const appId = document.createElement("span");
    appId.className = "app-id";
    setText(appId, pkg.id || "--");
    const identity = document.createElement("div");
    identity.className = "app-identity";
    const monogram = document.createElement("span");
    monogram.className = "app-monogram";
    monogram.setAttribute("aria-hidden", "true");
    setText(monogram, Array.from(pkg.name || pkg.id || "A")[0].toUpperCase());
    const copy = document.createElement("div");
    copy.className = "app-copy";
    copy.append(appName, appId);
    identity.append(monogram, copy);
    appCell.append(identity);

    const installedCell = createCell("version-text");
    setText(installedCell, pkg.installedVersion || "--");
    installedCell.title = pkg.installedVersion || "";

    const availableCell = createCell("available-version");
    setText(availableCell, pkg.availableVersion || "--");
    availableCell.title = pkg.availableVersion || "";

    const sourceCell = createCell("source-text");
    setText(sourceCell, pkg.source || "--");
    sourceCell.title = pkg.source || "";

    const statusCell = createCell();
    const updateItem = getUpdateItem(pkg.packageKey);
    const status = updateItem?.status || "available";
    const statusLabel = document.createElement("span");
    statusLabel.className = `row-status status-${status}`;
    setText(statusLabel, PACKAGE_STATUS_LABELS[status] || "可更新");
    if (updateItem?.diagnostic) statusLabel.title = updateItem.diagnostic;
    statusCell.append(statusLabel);

    const operationCell = createCell("operation-column");
    const updateButton = document.createElement("button");
    updateButton.type = "button";
    updateButton.className = "row-action";
    updateButton.disabled = !enabled || Boolean(model.busyAction);
    setText(updateButton, "更新");
    updateButton.setAttribute("aria-label", `更新 ${pkg.name || pkg.id || "应用"}`);
    updateButton.addEventListener("click", () => startUpdate([pkg.packageKey], "selected"));
    operationCell.append(updateButton);

    row.append(selectionCell, appCell, installedCell, availableCell, sourceCell, statusCell, operationCell);
    fragment.append(row);
  }
  ui.packageTableBody.append(fragment);
  renderPlaceholder(packages.length);
}

function renderPlaceholder(packageCount) {
  const state = model.state;
  if (packageCount > 0) {
    ui.tablePlaceholder.hidden = true;
    return;
  }
  ui.tablePlaceholder.hidden = false;
  if (!state || state.runtime?.scanStatus === "scanning") {
    setText(ui.placeholderTitle, "正在读取更新列表");
    setText(ui.placeholderDetail, "首次扫描可能需要一些时间。");
  } else if (!state.winget?.available) {
    setText(ui.placeholderTitle, state.backend === "homebrew" ? "无法使用 Homebrew" : "无法使用 winget");
    setText(ui.placeholderDetail, state.backend === "homebrew" ? "安装原生 Homebrew 后刷新，只管理 Homebrew 安装的软件。" : "安装或修复 Windows 程序包管理器后刷新。");
  } else if (state.runtime?.scanStatus === "error") {
    setText(ui.placeholderTitle, "扫描未完成");
    setText(ui.placeholderDetail, "检查运行日志后重试扫描。");
  } else {
    setText(ui.placeholderTitle, "没有可用更新");
    setText(ui.placeholderDetail, "当前已安装应用无需维护。");
  }
}

function renderExecutionTrack() {
  const update = model.state?.update;
  if (!update || update.status === "idle") {
    ui.executionTrack.hidden = true;
    return;
  }
  ui.executionTrack.hidden = false;
  const total = Number(update.total) || 0;
  const completed = Math.min(Number(update.completed) || 0, total);
  const items = Array.isArray(update.items) ? update.items : [];
  const activeKeys = new Set(Array.isArray(update.activePackageKeys) ? update.activePackageKeys : []);
  const activeItems = items.filter(item => activeKeys.has(item.packageKey));
  const current = activeItems[0];
  const failed = items.filter(item => item.status === "failed" || item.status === "not-updated").length;
  const succeeded = items.filter(item => item.status === "succeeded").length;
  const cancelled = items.filter(item => item.status === "cancelled").length;
  const unverified = items.filter(item => item.status === "unverified").length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const labelMap = {
    queued: "任务排队",
    running: "正在执行",
    verifying: "结果复查",
    cancelling: "正在取消",
    cancelled: "任务取消",
    completed: failed ? "完成 · 有失败" : unverified ? "完成 · 待确认" : "任务完成"
  };
  setText(ui.trackLabel, labelMap[update.status] || "更新队列");
  const activeNames = activeItems.slice(0, 2).map(item => item.name).join("、");
  const concurrency = Number(update.concurrency) || 1;
  const activeLabel = activeItems.length > 1 ? `正在更新 ${activeItems.length}/${concurrency} 项：${activeNames}` : current?.name;
  setText(ui.trackCurrent, activeLabel || (update.status === "verifying" ? "重新扫描应用版本" : FINAL_UPDATE_STATUSES.has(update.status) ? "本次维护任务已结束" : "正在准备…"));
  setText(ui.trackCount, `${completed} / ${total}`);
  setText(ui.trackSummary, `成功 ${succeeded} · 失败 ${failed} · 待确认 ${unverified} · 取消 ${cancelled}`);
  ui.progressRail.setAttribute("aria-valuemax", String(total));
  ui.progressRail.setAttribute("aria-valuenow", String(completed));
  ui.progressRail.setAttribute("aria-valuetext", `已完成 ${completed}/${total} 项`);
  ui.progressBar.style.width = `${percent}%`;
  ui.retryFailedButton.hidden = update.status !== "completed" || failed === 0;
  ui.retryFailedButton.disabled = model.busyAction === "retry";
  setText(ui.retryFailedButton, model.busyAction === "retry" ? "正在重试…" : "重试失败项");
}

function normalizeLog(entry) {
  return {
    id: entry?.id || `${entry?.timestamp || ""}:${entry?.scope || ""}:${entry?.code || ""}:${entry?.message || ""}`,
    timestamp: entry?.timestamp || null,
    level: String(entry?.level || "info").toLowerCase(),
    scope: entry?.scope || "app",
    code: entry?.code || "",
    message: entry?.message || ""
  };
}

function createLogEntry(entry) {
  const row = document.createElement("div");
  row.className = "log-entry";
  const time = document.createElement("time");
  time.className = "log-time";
  setText(time, formatDateTime(entry.timestamp).split(" ").pop());
  time.title = formatDateTime(entry.timestamp);
  const level = document.createElement("span");
  level.className = `log-level level-${entry.level}`;
  setText(level, LOG_LEVEL_LABELS[entry.level] || entry.level.toUpperCase());
  const scope = document.createElement("span");
  scope.className = "log-scope";
  setText(scope, entry.scope);
  scope.title = entry.code || "";
  const message = document.createElement("span");
  message.className = "log-message";
  setText(message, entry.message || entry.code || "无详细信息");
  row.append(time, level, scope, message);
  return row;
}

function renderLogs() {
  ui.logList.replaceChildren();
  setText(ui.logCount, model.logs.length);
  ui.clearLogsButton.disabled = model.logs.length === 0 || model.busyAction === "clearLogs";
  if (model.logs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "log-empty";
    setText(empty, "暂无运行日志");
    ui.logList.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of model.logs) fragment.append(createLogEntry(entry));
  ui.logList.append(fragment);
  ui.logList.scrollTop = ui.logList.scrollHeight;
}

function replaceLogs(entries) {
  model.logs = [];
  model.logIds.clear();
  for (const rawEntry of Array.isArray(entries) ? entries : []) addLog(rawEntry, false);
  renderLogs();
}

function addLog(rawEntry, shouldRender = true) {
  const entry = normalizeLog(rawEntry);
  if (model.logIds.has(entry.id)) return;
  model.logIds.add(entry.id);
  model.logs.push(entry);
  if (model.logs.length > 500) {
    const removed = model.logs.splice(0, model.logs.length - 500);
    for (const oldEntry of removed) model.logIds.delete(oldEntry.id);
  }
  if (shouldRender) renderLogs();
}

function renderSettings() {
  const settings = model.state?.persisted?.settings;
  if (!settings || (model.settingsInitialized && model.settingsDirty)) return;
  ui.scanInterval.value = String(settings.scanIntervalMinutes ?? 60);
  ui.notificationsEnabled.checked = settings.notificationsEnabled !== false;
  ui.openAtLogin.checked = settings.openAtLogin === true;
  const mac = model.state?.backend === "homebrew";
  ui.maxConcurrentUpdates.value = String(mac ? 1 : settings.maxConcurrentUpdates ?? 5);
  ui.maxConcurrentUpdates.disabled = mac;
  if (mac) ui.maxConcurrentUpdates.closest("label").querySelector("small").textContent = "Homebrew 逐项更新，避免软件包锁冲突";
  model.settingsInitialized = true;
  model.settingsDirty = false;
}

function renderIgnoredPackages() {
  const items = ignoredPackages();
  setText(ui.ignoredCount, items.length);
  ui.ignoredList.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("span");
    empty.className = "ignored-empty";
    setText(empty, "暂无忽略的软件");
    ui.ignoredList.append(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "ignored-item";
    const copy = document.createElement("div");
    copy.className = "ignored-copy";
    const name = document.createElement("strong");
    setText(name, item.name || item.id);
    const id = document.createElement("small");
    setText(id, `${item.source} · ${item.id}`);
    copy.append(name, id);
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "text-button ignored-restore";
    setText(restore, "恢复");
    restore.addEventListener("click", () => runAction("restore", async () => {
      await window.appApi.restoreIgnored(item.identity);
      showToast("已恢复该软件的更新。", false);
    }, "恢复忽略项失败。"));
    row.append(copy, restore);
    ui.ignoredList.append(row);
  }
}

function render(state) {
  model.state = state && typeof state === "object" ? state : null;
  reconcileSelection();
  renderWinget();
  setText(ui.lastScanTime, formatDateTime(model.state?.persisted?.lastSuccessfulScanAt || model.state?.snapshot?.createdAt));
  renderNotice();
  renderActions();
  renderExecutionTrack();
  renderTable();
  renderSettings();
  renderIgnoredPackages();
}

function showToast(message, isError = false) {
  clearTimeout(model.toastTimer);
  setText(ui.toast, message);
  ui.toast.className = `toast${isError ? " is-error" : ""}`;
  ui.toast.hidden = false;
  model.toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, 4500);
}

async function runAction(name, action, fallbackMessage) {
  if (model.busyAction) return;
  model.busyAction = name;
  renderActions();
  renderExecutionTrack();
  try {
    await action();
  } catch (error) {
    showToast(errorMessage(error, fallbackMessage), true);
  } finally {
    model.busyAction = null;
    renderActions();
    renderExecutionTrack();
  }
}

async function refresh() {
  await runAction("refresh", () => window.appApi.refresh(), "刷新失败，请检查运行日志。");
}

async function startUpdate(packageKeys, actionName) {
  const snapshotId = model.state?.snapshot?.snapshotId;
  if (!snapshotId || !Array.isArray(packageKeys) || packageKeys.length === 0) {
    showToast("请选择要更新的应用。", true);
    return;
  }
  const selected = currentPackages().filter(pkg => packageKeys.includes(pkg.packageKey));
  const unknownCount = selected.filter(pkg => pkg.installedVersionUnknown).length;
  const detail = model.state?.backend === "homebrew" ? "逐项更新 Homebrew 安装的软件及所需依赖。请先退出待更新应用；需要管理员权限的项目请在终端更新后刷新。" : unknownCount
    ? `其中 ${unknownCount} 项的当前版本未知，更新可能需要管理员确认。`
    : "更新期间可能出现管理员确认或安装器窗口。";
  const concurrency = model.state?.backend === "homebrew" ? 1 : Number(model.state?.persisted?.settings?.maxConcurrentUpdates) || 5;
  if (!window.confirm(`将更新 ${selected.length} 个应用，最多同时处理 ${concurrency} 项，并接受软件源及软件包协议。\n\n${detail}\n\n是否继续？`)) return;
  await runAction(actionName, async () => {
    await window.appApi.startUpdates(snapshotId, packageKeys);
    model.selectedKeys.clear();
  }, "无法启动更新任务。");
}

function bindEvents() {
  ui.refreshButton.addEventListener("click", refresh);
  ui.noticeRetryButton.addEventListener("click", refresh);
  ui.updateSelectedButton.addEventListener("click", () => startUpdate([...model.selectedKeys], "selected"));
  ui.updateAllButton.addEventListener("click", () => startUpdate(currentPackages().map(pkg => pkg.packageKey), "all"));
  ui.cancelButton.addEventListener("click", () => {
    const runId = model.state?.update?.runId;
    if (!runId) return;
    runAction("cancel", () => window.appApi.cancelUpdates(runId), "无法取消当前更新任务。");
  });
  ui.retryFailedButton.addEventListener("click", () => {
    const runId = model.state?.update?.runId;
    if (!runId) return;
    runAction("retry", () => window.appApi.retryFailed(runId), "无法重试失败项。");
  });
  ui.selectAllCheckbox.addEventListener("change", () => {
    model.selectedKeys.clear();
    if (ui.selectAllCheckbox.checked) {
      for (const pkg of currentPackages()) model.selectedKeys.add(pkg.packageKey);
    }
    renderTable();
    renderActions();
  });
  ui.clearLogsButton.addEventListener("click", () => {
    runAction("clearLogs", async () => {
      await window.appApi.clearLogs();
      replaceLogs([]);
    }, "无法清空日志。");
  });
  ui.settingsForm.addEventListener("input", () => {
    model.settingsDirty = true;
    setText(ui.settingsSaveState, "有未保存更改");
  });
  ui.settingsForm.addEventListener("submit", event => {
    event.preventDefault();
    const interval = Number(ui.scanInterval.value);
    const maxConcurrentUpdates = Number(ui.maxConcurrentUpdates.value);
    if (!Number.isInteger(interval) || interval < 15 || interval > 1440) {
      showToast("扫描间隔必须是 15 到 1440 分钟的整数。", true);
      ui.scanInterval.focus();
      return;
    }
    if (!Number.isInteger(maxConcurrentUpdates) || maxConcurrentUpdates < 1 || maxConcurrentUpdates > 5) {
      showToast("同时更新数量必须是 1 到 5 之间的整数。", true);
      ui.maxConcurrentUpdates.focus();
      return;
    }
    runAction("settings", async () => {
      ui.saveSettingsButton.disabled = true;
      setText(ui.settingsSaveState, "正在保存…");
      try {
        await window.appApi.updateSettings({
          scanIntervalMinutes: interval,
          notificationsEnabled: ui.notificationsEnabled.checked,
          openAtLogin: ui.openAtLogin.checked,
          maxConcurrentUpdates
        });
        model.settingsDirty = false;
        setText(ui.settingsSaveState, "已保存");
        showToast("设置已保存。", false);
      } finally {
        ui.saveSettingsButton.disabled = false;
      }
    }, "设置保存失败。");
  });
}

async function initialize() {
  bindEvents();
  render(null);
  renderLogs();
  if (!window.appApi) {
    setNotice("error", "无法连接维护服务", "应用接口未加载，请重新启动程序。" );
    ui.refreshButton.disabled = true;
    return;
  }

  window.appApi.onStateChanged(nextState => {
    render(nextState);
  });
  window.appApi.onLogEntry(entry => {
    addLog(entry);
  });

  try {
    const initialState = await window.appApi.getState();
    replaceLogs(initialState?.logs);
    render(initialState);
  } catch (error) {
    model.state = null;
    renderWinget();
    setNotice("error", "无法加载应用状态", errorMessage(error, "与主进程通信失败，请重新启动程序。"), true);
    showToast(errorMessage(error, "应用状态加载失败。"), true);
  }
}

void initialize();
