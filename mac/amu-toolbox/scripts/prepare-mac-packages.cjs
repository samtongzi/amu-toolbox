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
    description: update ? '集中检查应用更新，选择多款应用即可批量下载与安装。' : '后台关注额度重置动态，通过系统通知及时提醒。',
    features: update ? ['检查应用官网与 App Store 更新', '多选应用，批量下载与安装', '更新前校验，完成后复查版本', '菜单栏后台运行与原生应用图标'] : ['每 5 分钟检查 divin.cc 的公开重置记录', '新事件去重提醒', 'macOS 通知中心原生提醒', '顶部菜单栏操作与登录启动'],
    requirements: update ? 'macOS 12 或更新版本 · Apple Silicon。支持官网和 App Store 更新检测。可自动安装兼容的官网更新；商店应用通过 App Store 完成。' : 'macOS 12 或更新版本 · Apple Silicon。监控公开记录需要联网；这不是个人账户剩余额度查询。',
    usage: update ? '在菜单栏选择“显示主界面”，勾选应用后批量更新。请先退出待更新应用；商店应用使用对应入口。检查失败的应用静默跳过。' : '启动后在屏幕顶部菜单栏查看监控状态。请在系统通知设置中允许提醒；登录启动默认关闭。' };
});
fs.writeFileSync(path.join(root, 'catalog-mac.json'), JSON.stringify({ version: 1, platform: 'darwin', arch: 'arm64', apps }, null, 2) + '\n');
console.log('已内置两个 arm64 工具包并生成 SHA-256 校验清单');
