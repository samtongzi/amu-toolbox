from pathlib import Path
import json, zipfile, hashlib
ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / '阿木工具箱-Mac构建包'
KIT.mkdir(exist_ok=True)
def put(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
projects = ['app-update-monitor', 'codex-reset-notifier', 'amu-toolbox']
for project in projects:
    source = ROOT / project
    names = ['main.js', 'preload.js', 'package.json', 'package-lock.json', 'build.mac.cjs', 'catalog.json', 'README.md']
    files = [source / name for name in names if (source/name).is_file()]
    for folder in ['src', 'renderer', 'assets', 'test']:
        files.extend(p for p in (source/folder).rglob('*') if p.is_file())
    for name in ['sign-mac.cjs', 'prepare-mac-packages.cjs']:
        if (source/'scripts'/name).is_file(): files.append(source/'scripts'/name)
    for file in files: put(KIT/project/file.relative_to(source), file.read_bytes())
scripts = ROOT/'amu-toolbox/scripts'
put(KIT/'build-mac.command', (scripts/'build-mac-kit.command').read_bytes())
put(KIT/'scripts/verify-mac-build.cjs', (scripts/'verify-mac-build.cjs').read_bytes())
readme = '''# 阿木工具箱 · Apple Silicon 构建包

此包是源码及构建脚本，包含阿木工具箱、App 更新监测器、Codex 额度重置通知。
只生成 macOS arm64，不生成 Intel 或 Universal 版本。Windows EXE 没有放入此包。

## 在 M 芯片 Mac 上生成安装包

1. 解压整个文件夹到 Mac 的下载或文稿目录。
2. 安装原生 ARM64 Node.js 22 或更新 LTS：https://nodejs.org/ 。
3. 在终端运行 `xcode-select --install`，等待命令行工具安装完成（已安装则跳过）。
4. 打开终端，输入 `bash `（末尾一个空格），把本文件夹里的 `build-mac.command` 拖入终端，回车。

脚本会自动安装依赖、运行测试、构建两个工具、将工具安装包内置到工具箱，再生成 DMG 和 ZIP。
首次构建需要联网，下载 Electron 可能较慢。脚本不需要 sudo，不会安装 Homebrew 或修改系统安全设置。
下载修正版：npm 依赖与 Electron 运行文件分开安装；Electron 优先使用 npmmirror 镜像，失败自动重试并回退 GitHub。
保留 Electron 官方 npm 包内置的 SHA-256 校验，不关闭 HTTPS 证书检查。三个项目共用下载缓存，打包复用本地运行文件。
不需要升级 npm，也不需要清空整个 npm 缓存。脚本不会修改全局 npm registry。
日志自动写入 logs 文件夹。失败时把最新日志发来即可排查，修复环境后可重新运行脚本。

## 构建完成后

output 文件夹会自动打开，包含：

- `amu-toolbox-1.0.0-mac-arm64.dmg`：打开后把阿木工具箱拖进 Applications，再从 Applications 启动。
- `amu-toolbox-1.0.0-mac-arm64.zip`：工具箱压缩包。
- `app-update-monitor-1.0.4-mac-arm64.zip`：可独立使用的更新监测器。
- `codex-reset-notifier-1.0.2-mac-arm64.zip`：可独立使用的额度通知。
- `SHA256SUMS.txt`：产物校验值。

最低 macOS 12，M1/M2/M3/M4 等 Apple Silicon。程序只有 arm64，无需 Rosetta。
安装工具不需要联网，工具自身扫描或获取额度动态需要联网。
工具箱把独立工具安装在 `~/Applications/阿木工具箱/<工具标识>/`，可在“我的应用”打开、定位或卸载。
卸载前请从屏幕顶部菜单栏退出工具；卸载保留配置和历史，并关闭该工具的登录启动。
卸载工具箱本身不会移除已经安装的工具。

## Mac 版更新监测器

先按 Homebrew 官网 https://brew.sh/ 安装 Apple Silicon 原生 Homebrew（路径 `/opt/homebrew`）。
监测器仅管理通过 Homebrew 安装的 formula/cask；不扫描 App Store 或手动拖入的软件。
刷新会更新 Homebrew 元数据，再读取 JSON 更新列表。联网失败会显示具体原因，不会误显示全部已更新。
批量任务逐项执行，避免 Homebrew 锁冲突；更新结束重新核验实际版本。
请先退出待更新应用。需要管理员权限的安装器需在终端手动执行对应 `brew upgrade --cask 软件名`，再回到监测器刷新。
程序不会收集密码，也不会主动强制退出你的应用。Homebrew 可能同时更新所选软件所需的依赖。

## Mac 版额度通知

启动后查看屏幕顶部的秒表图标。可立即检查、测试毛玻璃通知、开启登录启动或退出。
Mac 版登录启动默认关闭。此工具读取 divin.cc 的公开重置记录，不读取个人账户额度。

## 验证范围与签名

已在 Windows 上通过源码逻辑测试；尚未在你的 Mac 上运行实际应用。
构建末尾自动核对 arm64 架构、应用签名、内置工具包大小和 SHA-256。首次使用请验证：
工具箱安装/导出/打开/卸载；更新监测器刷新与单项更新；额度工具测试通知及登录启动。
本包默认使用本机 ad-hoc 签名，不需要 Apple 开发者证书；这不等于 Developer ID 签名或 Apple 公证。
适合在你的 Mac 上构建和测试。公开分发给其他用户前，应改用 Developer ID 并完成公证。
不要关闭 Gatekeeper 或系统完整性保护；如系统阻止运行，请把提示原文反馈给作者。

## 开发与同步

源码保留 Windows/Mac 平台分支。三个项目继续使用各自的 `npm run build` 构建 Windows；
在 Mac 上运行顶层脚本可同步重新生成两个工具及工具箱。
Mac 打包配置为各项目 `build.mac.cjs`，目录数据由 `prepare-mac-packages.cjs` 自动生成。
工具箱未生成 Mac 目录前请先完整运行一次构建脚本。

参考：Homebrew 命令文档 https://docs.brew.sh/Manpage ，Electron Builder https://www.electron.build/ 。
'''
(KIT/'先看这里.md').write_text(readme, encoding='utf-8', newline='\n')
manifest = []
for file in sorted(KIT.rglob('*')):
    if file.is_file() and file.name != 'SOURCE-SHA256SUMS.txt':
        manifest.append(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.relative_to(KIT).as_posix()}')
(KIT/'SOURCE-SHA256SUMS.txt').write_text('\n'.join(manifest)+'\n', encoding='utf-8', newline='\n')
archive = ROOT.parent/'Desktop'/'阿木工具箱-Mac-AppleSilicon源码包.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for file in sorted(KIT.rglob('*')):
        if file.is_file():
            info = zipfile.ZipInfo((Path(KIT.name)/file.relative_to(KIT)).as_posix())
            info.create_system = 3
            info.external_attr = (0o100755 if file.suffix == '.command' else 0o100644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, file.read_bytes())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert not any('/node_modules/' in n or '/release/' in n or n.endswith('.exe') for n in z.namelist())
print(json.dumps({'folder': str(KIT), 'zip': str(archive), 'bytes': archive.stat().st_size, 'files': len(manifest)+1}, ensure_ascii=False))
