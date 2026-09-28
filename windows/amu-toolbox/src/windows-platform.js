const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const run = promisify(execFile);

async function powershell(script, env) {
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const wrapped = "$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; try { " + script + "; exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
  try {
    const { stdout } = await run(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(wrapped, "utf16le").toString("base64")],
      { windowsHide: true, timeout: 20000, env: { ...process.env, ...env } });
    return stdout.trim();
  } catch (error) {
    throw new Error(error.killed ? "读取系统状态超时，请稍后重试" : "无法读取或更新系统状态，请稍后重试");
  }
}

async function isRunning(target) {
  const result = await powershell("$ErrorActionPreference='Stop'; $p = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:AMU_TARGET_EXE }); if ($p.Count -gt 0) { 'running' } else { 'stopped' }", { AMU_TARGET_EXE: target });
  return result === "running";
}

async function removeOwnedStartup(name, target) {
  // Only remove a login entry when its executable is this managed installation.
  await powershell("$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Run',$true); if ($null -ne $key) { try { $value=[string]$key.GetValue($env:AMU_STARTUP_NAME); $expected='\"'+$env:AMU_TARGET_EXE+'\"'; if ($value -eq $env:AMU_TARGET_EXE -or $value.StartsWith($expected,[System.StringComparison]::OrdinalIgnoreCase)) { $key.DeleteValue($env:AMU_STARTUP_NAME,$false) } } finally { $key.Close() } }",
    { AMU_TARGET_EXE: target, AMU_STARTUP_NAME: name });
}

function launch(target) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const name of ["PORTABLE_EXECUTABLE_FILE", "PORTABLE_EXECUTABLE_DIR", "PORTABLE_EXECUTABLE_APP_FILENAME", "ELECTRON_RUN_AS_NODE"]) delete env[name];
    const child = spawn(target, [], { cwd: path.dirname(target), detached: true, stdio: "ignore", windowsHide: true, env });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

module.exports = { isRunning, removeOwnedStartup, launch };
