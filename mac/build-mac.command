#!/bin/bash
set -Eeuo pipefail
cd "$(dirname "$0")"
# Respect an explicitly selected Node.js runtime (for example an LTS PATH).
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
mkdir -p logs
exec > >(tee "logs/build-$(date +%Y%m%d-%H%M%S).log") 2>&1
trap 'build_status=$?; printf "\n构建失败（第 %s 行，退出码 %s）。请把 logs 文件夹中最新日志发给阿木工具箱作者。\n" "$LINENO" "$build_status"; exit "$build_status"' ERR
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo '请在 M 芯片 Mac 的原生终端中运行，不支持 Intel 或 Rosetta 终端。'; exit 1
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo '请先安装 Node.js 22 或 24 LTS（macOS ARM64），再运行本脚本。'; exit 1
fi
node -e 'if(process.arch!=="arm64" || ![22,24].includes(Number(process.versions.node.split(".")[0]))){console.error("此构建包需要原生 arm64 Node.js 22 或 24 LTS；Node.js 26 下 Electron 解压可能提前结束。请将 LTS 的 bin 目录放在 PATH 首位后重试。");process.exit(1)}'
if ! xcode-select -p >/dev/null 2>&1; then
  echo '请先在终端运行 xcode-select --install，等待安装完成后重试。'; exit 1
fi
/usr/bin/xcrun --find codesign >/dev/null
export CSC_IDENTITY_AUTO_DISCOVERY=false
# Native Node was checked above; --arm64 is also enforced by build:mac.
# npm 11+ warns about the obsolete npm_config_arch environment setting.
unset npm_config_arch npm_config_platform ELECTRON_SKIP_BINARY_DOWNLOAD

install_dependencies() {
  local attempt
  for attempt in 1 2 3; do
    echo "安装 npm 依赖（第 $attempt/3 次）；Electron 运行文件将在下一步单独下载。"
    if ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund --fetch-retries=3 --fetch-timeout=120000; then
      return 0
    fi
    if [ "$attempt" != 3 ]; then echo '依赖安装未完成，3 秒后重试。'; sleep 3; fi
  done
  echo 'npm 依赖安装连续失败，请检查网络并查看以上错误。'
  return 1
}

install_electron() {
  local mirror attempt
  # Same version in all three projects: @electron/get shares the verified cache.
  # Keep the checksums embedded in the official npm package; never disable TLS.
  for mirror in "${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}" 'https://github.com/electron/electron/releases/download/'; do
    for attempt in 1 2; do
      echo "准备 Electron arm64（下载源：${mirror}，第 ${attempt}/2 次）"
      if env -u ELECTRON_SKIP_BINARY_DOWNLOAD -u electron_use_remote_checksums -u npm_config_electron_use_remote_checksums \
        -u npm_config_electron_mirror -u NPM_CONFIG_ELECTRON_MIRROR -u ELECTRON_OVERRIDE_DIST_PATH \
        ELECTRON_MIRROR="$mirror" node node_modules/electron/install.js; then
        if [ "$(/usr/bin/lipo -archs 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')" != arm64 ]; then
          echo 'Electron 架构校验失败，需要 arm64 运行文件。'; return 1
        fi
        echo 'Electron 运行文件已就绪，打包阶段将直接复用。'
        return 0
      fi
      echo '本次下载未完成，将重试或切换下载源。'
      sleep 3
    done
  done
  echo '两个下载源均未成功。请更换网络后重新运行，已下载缓存会保留。'
  return 1
}

echo '开始构建 Apple Silicon 专用版本。首次运行需联网下载依赖和 Electron。'
for project in app-update-monitor codex-reset-notifier; do
  echo "构建 $project"
  (cd "$project"; install_dependencies; install_electron; npm test; npm run build:mac -- --config.electronDist=node_modules/electron/dist)
done
(cd amu-toolbox; install_dependencies; install_electron; npm test; node scripts/prepare-mac-packages.cjs; npm run build:mac -- --config.electronDist=node_modules/electron/dist)
node scripts/verify-mac-build.cjs
echo '构建完成。安装包位于 output 文件夹；请打开 DMG 并将阿木工具箱拖入 Applications。'
open output
