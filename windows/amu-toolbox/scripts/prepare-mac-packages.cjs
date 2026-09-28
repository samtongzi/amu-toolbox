const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const catalog = require('../catalog.json');
fs.mkdirSync(path.join(root, 'packages-mac'), { recursive: true });
const apps = catalog.apps.map(item => {
  const project = path.resolve(root, '..', item.id);
  const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
  const file = `${pkg.name}-${pkg.version}-mac-arm64.zip`;
  const data = fs.readFileSync(path.join(project, 'release-mac', file));
  fs.writeFileSync(path.join(root, 'packages-mac', file), data);
  const update = item.id === 'app-update-monitor';
  return { ...item, file, version: pkg.version, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'),
    bundleName: `${pkg.build.productName}.app`, bundleExecutable: pkg.build.productName, bundleId: pkg.build.appId,
    features: update ? ['扫描 Homebrew 安装的软件和命令行工具', '逐项批量更新、忽略项目与定时检查', '更新后复查，区分失败与结果待确认', '原生毛玻璃界面与顶部菜单栏'] : ['每 5 分钟检查 divin.cc 的公开重置记录', '新事件去重提醒', '紧凑毛玻璃通知卡片', '顶部菜单栏操作、测试通知与登录启动'],
    requirements: update ? 'macOS 12 或更新版本 · Apple Silicon。需在 /opt/homebrew 安装原生 Homebrew；扫描和更新需要联网，仅管理 Homebrew 安装的软件。' : 'macOS 12 或更新版本 · Apple Silicon。监控公开记录需要联网；这不是个人账户剩余额度查询。',
    usage: update ? '刷新检查更新，选择软件后逐项更新。先退出待更新应用；需要管理员权限的项目请在终端更新后刷新。关闭窗口后留在顶部菜单栏。' : '启动后在屏幕顶部菜单栏查看状态或测试通知。登录启动默认关闭，可在菜单中开启。' };
});
fs.writeFileSync(path.join(root, 'catalog-mac.json'), JSON.stringify({ version: 1, platform: 'darwin', arch: 'arm64', apps }, null, 2) + '\n');
console.log('已内置两个 arm64 工具包并生成 SHA-256 校验清单');
