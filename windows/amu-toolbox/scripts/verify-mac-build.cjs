const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('产物验证必须在 Apple Silicon Mac 上运行');
const output = path.join(root, 'output');
fs.mkdirSync(output, { recursive: true });
const manifest = [];
for (const project of ['app-update-monitor', 'codex-reset-notifier', 'amu-toolbox']) {
  const dir = path.join(root, project), pkg = require(path.join(dir, 'package.json'));
  const bundle = path.join(dir, 'release-mac', 'mac-arm64', `${pkg.build.productName}.app`);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
  const executable = path.join(bundle, 'Contents', 'MacOS', pkg.build.productName);
  const arch = execFileSync('/usr/bin/lipo', ['-archs', executable], { encoding: 'utf8' }).trim();
  if (arch !== 'arm64') throw new Error(`架构不符: ${project}: ${arch}`);
  const extensions = project === 'amu-toolbox' ? ['dmg', 'zip'] : ['zip'];
  for (const ext of extensions) {
    const file = `${pkg.name}-${pkg.version}-mac-arm64.${ext}`, from = path.join(dir, 'release-mac', file);
    const data = fs.readFileSync(from);
    fs.copyFileSync(from, path.join(output, file));
    manifest.push(`${crypto.createHash('sha256').update(data).digest('hex')}  ${file}`);
  }
  if (project === 'amu-toolbox') {
    const catalog = require(path.join(dir, 'catalog-mac.json'));
    for (const app of catalog.apps) {
      const data = fs.readFileSync(path.join(bundle, 'Contents', 'Resources', 'packages', app.file));
      if (data.length !== app.size || crypto.createHash('sha256').update(data).digest('hex') !== app.sha256) throw new Error(`内置工具包校验失败: ${app.id}`);
    }
  }
  console.log(`签名、arm64 架构验证通过: ${pkg.build.productName}`);
}
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), manifest.join('\n')+'\n');
