const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const isMac = process.platform === "darwin";
const Library = isMac ? require("./src/mac-library").MacLibrary : require("./src/library").Library;
const platform = isMac ? require("./src/mac-platform") : require("./src/windows-platform");
const { apps: catalog } = isMac ? require("./catalog-mac.json") : require("./catalog.json");

if (!isMac) app.setAppUserModelId("cn.amu.toolbox");
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
let window, library, revision = 0, closingDialog = false;

async function publish() {
  const current = ++revision;
  const state = await library.snapshot();
  if (current === revision && window && !window.isDestroyed()) window.webContents.send("toolbox:state", state);
}

function focusWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}

async function initialize() {
  const testRoot = !app.isPackaged && process.env.AMU_TOOLBOX_TEST_ROOT;
  const installRoot = isMac && !testRoot ? path.join(app.getPath("home"), "Applications", "阿木工具箱") : path.join(testRoot || path.join(process.env.LOCALAPPDATA || app.getPath("userData"), "AmuToolbox"), "apps");
  const shortcutsRoot = testRoot ? path.join(testRoot, "shortcuts") : path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "阿木工具箱");
  library = new Library({ catalog, packageRoot: app.isPackaged ? path.join(process.resourcesPath, "packages") : path.join(__dirname, isMac ? "packages-mac" : "packages"),
    installRoot, shortcutsRoot, shell, platform, onChange: () => { void publish().catch(console.error); } });
  const acrylic = process.platform === "win32" && Number(os.release().split(".")[2]) >= 22621;
  window = new BrowserWindow({
    width: 1160, height: 800, minWidth: 900, minHeight: 620, show: false,
    title: "阿木工具箱", icon: path.join(__dirname, isMac ? "assets/icon.png" : "assets/icon.ico"),
    titleBarStyle: "hidden",
    ...(isMac ? { trafficLightPosition: { x: 20, y: 16 }, vibrancy: "sidebar", visualEffectState: "active" } : { titleBarOverlay: { color: "#00000000", symbolColor: "#727489", height: 40 } }),
    backgroundColor: (acrylic || isMac) ? "#00000000" : "#eef0f9",
    ...(acrylic ? { backgroundMaterial: "acrylic" } : {}),
    webPreferences: { preload: path.join(__dirname, "preload.js"), nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.on("close", event => {
    if (!library.active) return;
    event.preventDefault();
    if (!closingDialog) {
      closingDialog = true;
      void dialog.showMessageBox(window, { type: "info", title: "任务仍在进行", message: "请等待当前任务完成后再关闭工具箱。", detail: "你也可以在“下载管理”中取消正在复制的任务。", buttons: ["返回工具箱"] }).finally(() => { closingDialog = false; });
    }
  });
  window.on("focus", () => { void publish().catch(console.error); });

  const handle = (channel, handler) => ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false, error: "无效请求" };
    try { return { ok: true, value: await handler(...args) }; }
    catch (error) { console.error(channel, error); return { ok: false, error: error.message || "操作失败，请重试" }; }
  });
  handle("toolbox:state", () => library.snapshot());
  handle("toolbox:install", id => library.install(id));
  handle("toolbox:launch", id => library.launch(id));
  handle("toolbox:cancel", () => library.cancel());
  handle("toolbox:export", async id => {
    const item = library.app(id);
    if (library.active) throw new Error("请先等待当前任务完成");
    const result = await dialog.showSaveDialog(window, { title: `导出 ${item.name} 便携版`, defaultPath: path.join(app.getPath("downloads"), item.file), filters: [isMac ? { name: "Mac 应用压缩包", extensions: ["zip"] } : { name: "Windows 应用", extensions: ["exe"] }] });
    if (result.canceled) return { cancelled: true };
    await library.exportPackage(id, result.filePath);
    return { cancelled: library.jobs[0]?.status === "cancelled" };
  });
  handle("toolbox:uninstall", async id => {
    const item = library.app(id);
    const result = await dialog.showMessageBox(window, { type: "question", title: "卸载工具", message: `卸载“${item.name}”？`, detail: "将移除由阿木工具箱安装的程序和快捷方式。工具的配置、历史记录以及你原来单独保存的版本都会保留。", buttons: ["保留", "卸载"], defaultId: 0, cancelId: 0, noLink: true });
    if (result.response !== 1) return { cancelled: true };
    await library.uninstall(id);
    return { cancelled: false };
  });
  handle("toolbox:show-folder", async id => {
    const item = library.app(id);
    if (!await library.installed(item)) throw new Error("请先安装这个工具");
    shell.showItemInFolder(library.executable(id));
  });
  handle("toolbox:show-export", jobId => {
    const job = library.jobs.find(job => job.id === jobId && job.type === "export" && job.status === "completed");
    if (!job?.path) throw new Error("未找到已导出的文件");
    shell.showItemInFolder(job.path);
  });
  handle("toolbox:installation-folder", async () => {
    await fs.mkdir(installRoot, { recursive: true });
    const error = await shell.openPath(installRoot);
    if (error) throw new Error(error);
  });
  await window.loadFile(path.join(__dirname, "renderer/index.html"));
  window.show();
}

if (hasLock) {
  app.whenReady().then(initialize).catch(error => { dialog.showErrorBox("阿木工具箱启动失败", error.message); app.quit(); });
  app.on("second-instance", focusWindow);
  app.on("activate", focusWindow);
  app.on("window-all-closed", () => app.quit());
}
