"""Exercise Bash retries without downloading or requiring a Mac."""
from pathlib import Path
import subprocess, tempfile

root = Path(__file__).resolve().parent
script = (root/'build-mac-kit.command').read_text(encoding='utf-8')
functions = script[script.index('install_dependencies() {'):script.index("echo '开始构建 Apple Silicon")]
functions = functions.replace('/usr/bin/lipo', 'fake_lipo')
harness = r'''
set -euo pipefail
npm_calls=0
download_calls=0
scenario=retry
npm() {
  npm_calls=$((npm_calls + 1))
  [ "${ELECTRON_SKIP_BINARY_DOWNLOAD:-}" = 1 ] || return 99
  if [ "$scenario" = npm_fail ]; then return 1; fi
  [ "$npm_calls" -ge 2 ]
}
sleep() { :; }
fake_lipo() { if [ "$scenario" = wrong_arch ]; then echo x86_64; else echo arm64; fi; }
env() {
  download_calls=$((download_calls + 1))
  case "$scenario" in
    fallback) [ "$download_calls" -ge 3 ] ;;
    download_fail) return 1 ;;
    *) return 0 ;;
  esac
}
install_dependencies
[ "$npm_calls" = 2 ]
scenario=npm_fail
npm_calls=0
if install_dependencies; then echo 'Unexpected dependency success'; exit 1; fi
[ "$npm_calls" = 3 ]
scenario=fallback
install_electron
[ "$download_calls" = 3 ]
scenario=download_fail
download_calls=0
if install_electron; then echo 'Unexpected download success'; exit 1; fi
[ "$download_calls" = 4 ]
scenario=wrong_arch
if install_electron; then echo 'Wrong architecture accepted'; exit 1; fi
echo 'PASS: npm retry/retry limit, mirror fallback/download limit, architecture rejection'
'''
with tempfile.TemporaryDirectory(prefix='amu-download-test-') as temp:
    test_file = Path(temp)/'recovery.sh'
    test_file.write_text(functions+harness, encoding='utf-8', newline='\n')
    subprocess.run(['C:/Program Files/Git/bin/bash.exe', str(test_file)], check=True)
