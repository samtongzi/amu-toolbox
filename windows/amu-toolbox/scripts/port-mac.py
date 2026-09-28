from pathlib import Path
import json
ROOT = Path(__file__).resolve().parents[2]
def edit(project, name, old, new):
    p = ROOT / project / name
    text = p.read_text(encoding='utf-8-sig')
    if old not in text: raise RuntimeError(f'Missing match: {p}: {old[:70]}')
    p.write_text(text.replace(old, new), encoding='utf-8', newline='\n')

for project, startup in [('app-update-monitor', 'src/services/startup-service.js'), ('codex-reset-notifier', 'src/startup-service.js')]:
    edit(project, startup, 'executablePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath })', 'executablePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, platform = process.platform })')
    edit(project, startup, 'this.app = app;', 'this.app = app;\n    this.platform = platform;')
    edit(project, startup, 'process.platform === "win32" && this.app.isPackaged', '["win32", "darwin"].includes(this.platform) && this.app.isPackaged')
    edit(project, startup, 'this.app.setLoginItemSettings({', 'if (this.platform === "darwin") { this.app.setLoginItemSettings({ openAtLogin: enabled }); return true; }\n    this.app.setLoginItemSettings({')
    edit(project, startup, 'const settings = this.app.getLoginItemSettings(', 'if (this.platform === "darwin") return this.app.getLoginItemSettings().openAtLogin;\n    const settings = this.app.getLoginItemSettings(')
    edit(project, 'main.js', 'const hasSingleInstanceLock = app.requestSingleInstanceLock();\nif (!hasSingleInstanceLock) app.quit();', '''const cleanupStartup = process.platform === "darwin" && app.isPackaged && process.argv.includes("--amu-disable-startup");
const hasSingleInstanceLock = !cleanupStartup && app.requestSingleInstanceLock();
if (cleanupStartup) app.whenReady().then(() => { app.setLoginItemSettings({ openAtLogin: false }); app.quit(); }).catch(() => app.exit(1));
else if (!hasSingleInstanceLock) app.quit();''')

p = 'app-update-monitor'
edit(p, 'main.js', 'const iconPath = path.join(__dirname, "assets", "icon.ico");', 'const isMac = process.platform === "darwin";\n  const iconPath = path.join(__dirname, "assets", isMac ? "icon.png" : "icon.ico");')
edit(p, 'main.js', '"assets", "tray.png"));', '"assets", isMac ? "trayTemplate.png" : "tray.png"));\n  if (isMac) icon.setTemplateImage(true);')
edit(p, 'main.js', '  const client = isMock', '  const wingetState = { available: false, version: null, backend: isMac ? "homebrew" : "winget" };\n  const client = isMock')
edit(p, 'main.js', ': new WingetClient({ runner: new ProcessRunner() });', ': isMac ? new (require("./src/homebrew/client").HomebrewClient)({ runner: new ProcessRunner(), onAvailability: state => { wingetState.available = state.available; wingetState.version = state.version; } })\n    : new WingetClient({ runner: new ProcessRunner() });')
edit(p, 'main.js', '  const wingetState = { available: false, version: null };\n', '')
edit(p, 'main.js', 'getConcurrency: () => monitor.getState()?.settings?.maxConcurrentUpdates', 'getConcurrency: () => isMac ? 1 : monitor.getState()?.settings?.maxConcurrentUpdates')
edit(p, 'main.js', '  onLog(probe.available ? "info" : "error", "winget",', '  if (isMac) onLog(probe.available ? "info" : "error", "homebrew", probe.available ? "brew-ready" : "brew-unavailable", probe.available ? probe.version : "未找到原生 Homebrew，请安装到 /opt/homebrew 后刷新");\n  else onLog(probe.available ? "info" : "error", "winget",')
edit(p, 'main.js', 'app.on("second-instance", () => windowController?.show());', 'app.on("second-instance", () => windowController?.show());\n  app.on("activate", () => windowController?.show());')
edit(p, 'main.js', 'if (!process.argv.includes("--background")) windowController.show();', 'if (!process.argv.includes("--background") && !(isMac && app.getLoginItemSettings().wasOpenedAtLogin)) windowController.show();')
edit(p, 'src/services/scan-service.js', 'this.client.scan({ signal })', 'this.client.scan({ signal, reason })')
edit(p, 'src/services/scan-service.js', 'const messages = {', '''const messages = {
    "brew-unavailable": "Homebrew 不可用，请安装原生 Homebrew 后刷新",
    "brew-scan-failed": "Homebrew 扫描失败，请查看以下详情",
    "brew-parse-error": "Homebrew 返回的应用列表无法解析",
    "brew-output-too-large": "Homebrew 输出过大，扫描未完成",''')
edit(p, 'src/services/app-controller.js', 'winget: { available:', 'backend: this.winget.backend || "winget",\n      winget: { available:')
edit(p, 'src/controllers/window-controller.js', 'backgroundColor: "#e9e9f7",', 'backgroundColor: process.platform === "darwin" ? "#00000000" : "#e9e9f7",\n      ...(process.platform === "darwin" ? { vibrancy: "sidebar", visualEffectState: "active" } : {}),')
edit(p, 'src/winget/process-runner.js', 'signal, onStarted }', 'signal, onStarted, env }')
edit(p, 'src/winget/process-runner.js', 'windowsHide: true,\n          shell: false,', 'windowsHide: true,\n          detached: process.platform !== "win32",\n          ...(env ? { env } : {}),\n          shell: false,')
edit(p, 'src/winget/process-runner.js', 'let spawnError = null;', 'let spawnError = null;\n      let terminating = false;')
edit(p, 'src/winget/process-runner.js', 'if (settled) return;\n        if (reason', 'if (settled || terminating) return;\n        terminating = true;\n        if (reason')
edit(p, 'src/winget/process-runner.js', 'Promise.resolve(this.killProcessTree(child.pid)).finally(', 'Promise.resolve(this.killProcessTree(child.pid)).catch(() => {}).finally(')
edit(p, 'src/winget/process-runner.js', '  return new Promise(resolve => {\n    const killer', '''  if (process.platform !== "win32") {
    // Each command is spawned in its own process group, including its children.
    try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const killer''')
edit(p, 'renderer/app.js', 'setNotice("error", "winget 不可用", "请安装或修复 Windows 程序包管理器后重试。", true);', 'setNotice("error", state.backend === "homebrew" ? "Homebrew 不可用" : "winget 不可用", state.backend === "homebrew" ? "请先安装 Apple Silicon 版 Homebrew（/opt/homebrew），再点击刷新。" : "请安装或修复 Windows 程序包管理器后重试。", true);')
edit(p, 'renderer/app.js', '"winget 正在检查已安装应用和软件源。取消前请等待扫描完成。"', '"正在检查已安装应用和软件源。取消前请等待扫描完成。"')
edit(p, 'renderer/index.html', '登录 Windows 后在后台运行', '登录电脑后在后台运行')

p = 'codex-reset-notifier'
edit(p, 'main.js', 'async function initialize() {', 'async function initialize() {\n  const isMac = process.platform === "darwin";\n  if (isMac) app.dock.hide();')
edit(p, 'main.js', '"assets", "tray.png"));', '"assets", isMac ? "trayTemplate.png" : "tray.png"));\n  if (isMac) trayIcon.setTemplateImage(true);')
edit(p, 'main.js', 'startupService.setEnabled(true);\n      await monitor.setOpenAtLogin(true);', 'startupService.setEnabled(!isMac);\n      await monitor.setOpenAtLogin(!isMac);')
edit(p, 'src/toast-service.js', 'title: "Codex 额度通知", icon: path.join(__dirname, "../assets/icon.ico"),', 'title: "Codex 额度通知", icon: path.join(__dirname, process.platform === "darwin" ? "../assets/icon.png" : "../assets/icon.ico"),')
edit(p, 'src/toast-service.js', '...(acrylic ? { backgroundMaterial: "acrylic" } : {}),', '...(acrylic ? { backgroundMaterial: "acrylic" } : {}),\n        ...(process.platform === "darwin" ? { vibrancy: "hud", visualEffectState: "active" } : {}),')
edit(p, 'src/toast-service.js', '          acrylic\n', '          acrylic: acrylic || process.platform === "darwin"\n')
edit(p, 'src/notification-service.js', 'if (tray && !tray.isDestroyed()) tray.displayBalloon', 'if (process.platform === "win32" && tray && !tray.isDestroyed()) tray.displayBalloon')

p = 'amu-toolbox'
edit(p, 'main.js', 'const { Library } = require("./src/library");\nconst platform = require("./src/windows-platform");\nconst { apps: catalog } = require("./catalog.json");', '''const isMac = process.platform === "darwin";
const Library = isMac ? require("./src/mac-library").MacLibrary : require("./src/library").Library;
const platform = isMac ? require("./src/mac-platform") : require("./src/windows-platform");
const { apps: catalog } = isMac ? require("./catalog-mac.json") : require("./catalog.json");''')
edit(p, 'main.js', 'const installRoot = path.join(testRoot ||', 'const installRoot = isMac && !testRoot ? path.join(app.getPath("home"), "Applications", "阿木工具箱") : path.join(testRoot ||')
edit(p, 'main.js', 'icon: path.join(__dirname, "assets/icon.ico"),', 'icon: path.join(__dirname, isMac ? "assets/icon.png" : "assets/icon.ico"),')
edit(p, 'main.js', 'titleBarStyle: "hidden", titleBarOverlay: { color: "#00000000", symbolColor: "#727489", height: 40 },', 'titleBarStyle: "hidden",\n    ...(isMac ? { trafficLightPosition: { x: 20, y: 16 }, vibrancy: "sidebar", visualEffectState: "active" } : { titleBarOverlay: { color: "#00000000", symbolColor: "#727489", height: 40 } }),')
edit(p, 'main.js', 'backgroundColor: acrylic ?', 'backgroundColor: (acrylic || isMac) ?')
edit(p, 'main.js', 'path.join(process.resourcesPath, "packages") : path.join(__dirname, "packages")', 'path.join(process.resourcesPath, "packages") : path.join(__dirname, isMac ? "packages-mac" : "packages")')
edit(p, 'main.js', 'filters: [{ name: "Windows 应用", extensions: ["exe"] }]', 'filters: [isMac ? { name: "Mac 应用压缩包", extensions: ["zip"] } : { name: "Windows 应用", extensions: ["exe"] }]')
edit(p, 'src/library.js', 'return { apps, jobs:', 'return { platform: process.platform === "darwin" ? "macOS · Apple Silicon" : "Windows", apps, jobs:')
edit(p, 'renderer/app.js', '<span>Windows</span>', '<span>${escape(state.platform || "Windows")}</span>')
edit(p, 'renderer/app.js', 'notify("已启动。常驻工具可在右下角托盘中找到。");', 'notify(state.platform?.startsWith("macOS") ? "已启动。常驻工具可在屏幕顶部菜单栏找到。" : "已启动。常驻工具可在右下角托盘中找到。");')
edit(p, 'renderer/app.js', 'function render() {', '''function render() {
  const mac = state.platform?.startsWith("macOS");
  document.body.classList.toggle("mac", !!mac);
  $(".sidebar-bottom > span").textContent = `v1.0.0 · ${mac ? "Apple Silicon" : "Windows"}`;
  $("#exportDescription").textContent = mac ? "安装包已内置，无需联网下载。选择“安装”保存到个人应用文件夹；选择“导出便携版”保存 ZIP，解压后可单独运行。" : "安装包已内置，无需联网下载。选择“安装”由工具箱管理；选择“导出便携版”保存可单独运行的 EXE 文件。";''')
edit(p, 'renderer/index.html', '<p>安装包已内置', '<p id="exportDescription">安装包已内置')
css = ROOT/p/'renderer/styles.css'
with css.open('a', encoding='utf-8', newline='\n') as f: f.write('\nbody.mac .titlebar{padding-left:100px}body.mac{background:linear-gradient(120deg,#eff3fa99,#f5f5fb99 62%,#eceaf799)}\n')

for project in ['app-update-monitor', 'codex-reset-notifier', 'amu-toolbox']:
    root = ROOT/project
    pkg = json.loads((root/'package.json').read_text(encoding='utf-8-sig'))
    pkg['scripts']['build:mac'] = 'electron-builder --config build.mac.cjs --mac --arm64 --publish never'
    (root/'package.json').write_text(json.dumps(pkg, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    targets = "['dmg', 'zip']" if project=='amu-toolbox' else "['zip']"
    extra = ", extraResources: [{ from: 'packages-mac', to: 'packages', filter: ['*.zip'] }], files: [...base.files, 'catalog-mac.json']" if project=='amu-toolbox' else ''
    config = "const base = require('./package.json').build;\nmodule.exports = { ...base, directories: { output: 'release-mac' }"+extra+", mac: { target: "+targets+", category: 'public.app-category.utilities', icon: 'assets/icon.png', identity: '-', hardenedRuntime: true, entitlements: 'assets/entitlements.mac.plist', entitlementsInherit: 'assets/entitlements.mac.plist', minimumSystemVersion: '12.0', notarize: false, artifactName: '${name}-${version}-mac-${arch}.${ext}' } };\n"
    (root/'build.mac.cjs').write_text(config, encoding='utf-8', newline='\n')
    (root/'assets/entitlements.mac.plist').write_text('''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/><key>com.apple.security.cs.disable-library-validation</key><true/></dict></plist>
''', encoding='utf-8', newline='\n')
print('Mac platform integration complete')
