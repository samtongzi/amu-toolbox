const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const sources = [
  { id: "app-update-monitor", project: "app-update-monitor", file: "App更新监测器.exe", name: "App 更新监测器", category: "系统维护", icon: "update.svg", startupName: "AppUpdateMonitor",
    tagline: "让应用更新，变得简单。", description: "一键扫描与管理电脑上的应用更新，告别逐个检查。",
    features: ["扫描 winget 可识别的应用更新", "支持批量更新、忽略项目与定时检查", "更新后重新核验，减少误报", "清晰的运行日志与毛玻璃界面"],
    requirements: "Windows 10 / 11 · 64 位，需要已安装 winget。扫描和更新应用时需要联网。",
    usage: "启动后点击“刷新”检查更新，再选择需要更新的应用。关闭窗口后留在托盘，可从托盘退出。" },
  { id: "codex-reset-notifier", project: "codex-reset-notifier", file: "Codex额度重置通知.exe", name: "Codex 额度重置通知", category: "效率提醒", icon: "reset.svg", startupName: "CodexResetNotifier",
    tagline: "额度重置，及时知道。", description: "后台关注 Codex 额度重置动态，用轻巧的卡片通知你。",
    features: ["每 5 分钟检查 divin.cc 的公开重置记录", "新事件去重提醒，不重复推送旧记录", "紧凑的毛玻璃通知，支持深浅色", "托盘操作、测试通知与开机启动"],
    requirements: "Windows 10 / 11 · 64 位。监控公开重置记录需要联网；这不是个人账户的剩余额度查询。",
    usage: "启动后常驻右下角托盘，点击托盘图标可检查状态或测试通知。首次启动默认开机运行，可在托盘菜单关闭。" }
];
fs.mkdirSync(path.join(root, "packages"), { recursive: true });
const apps = sources.map(({ project, ...item }) => {
  const source = path.resolve(root, "..", project);
  const data = fs.readFileSync(path.join(source, "release", item.file));
  const version = JSON.parse(fs.readFileSync(path.join(source, "package.json"))).version;
  fs.copyFileSync(path.join(source, "release", item.file), path.join(root, "packages", item.file));
  fs.copyFileSync(path.join(source, "assets/icon.svg"), path.join(root, "assets", item.icon));
  return { ...item, version, size: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") };
});
fs.writeFileSync(path.join(root, "catalog.json"), JSON.stringify({ version: 1, apps }, null, 2) + "\n");
console.log(apps.map(app => `${app.name} v${app.version} · ${app.size} bytes`).join("\n"));
