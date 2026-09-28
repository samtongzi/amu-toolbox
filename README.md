# 阿木工具箱

阿木工具箱及独立桌面工具的源码。安装包放在 [Releases](https://github.com/samtongzi/amu-toolbox/releases)，不纳入 Git 历史。

## 版本与平台

| 程序 | macOS Apple Silicon | Windows x64 |
| --- | --- | --- |
| 阿木工具箱 | 1.1.2（DMG、ZIP） | 1.0.0（安装版、便携版 EXE） |
| App 更新监测器 | 1.1.2（ZIP） | 1.0.4（便携版 EXE） |
| Codex 额度重置通知 | 1.0.6（ZIP） | 1.0.2（便携版 EXE） |

Mac 版支持 macOS 12 及更新版本的 Apple Silicon Mac。Windows 版更新监测器使用 `winget` 扫描本机可识别的应用，只有用户点击更新后才会执行安装。

## 源码目录

- `mac/`：Mac 工具箱、两个子工具及统一构建脚本。运行 `cd mac && bash build-mac.command`；环境要求见 [Mac 构建说明](mac/先看这里.md)。
- `windows/amu-toolbox/`：Windows x64 工具箱 1.0.0 源码。构建前把 Release 的 `app-update-monitor-1.0.4-win-x64-portable.exe` 和 `codex-reset-notifier-1.0.2-win-x64-portable.exe` 下载到该目录的 `packages/`，分别重命名为 `App更新监测器.exe` 和 `Codex额度重置通知.exe`；再运行 `npm ci && npm test && npm run build`。
- `windows/app-update-monitor/`：所提供的 Windows x64 更新监测器 1.0.4 源码。在 Windows 上运行 `npm ci && npm test && npm run build`。

Mac 工具箱安装包包含两个子工具，也提供各子工具的独立 ZIP。Mac 产物使用本机 ad-hoc 签名，没有 Apple Developer ID 签名或公证；首次打开时可能受到 macOS 安全机制限制。

发布包的 SHA-256 校验值见 [SHA256SUMS.txt](SHA256SUMS.txt)，Release 中也附有同一文件。源码目录中的构建缓存、依赖和安装包已排除在 Git 之外。
