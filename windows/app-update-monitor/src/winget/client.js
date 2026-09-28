const { MAX_OUTPUT_BYTES, PROBE_TIMEOUT_MS, SCAN_TIMEOUT_MS, UPDATE_TIMEOUT_MS } = require("../config");
const { parseUpgradeOutput, PACKAGE_ID_PATTERN } = require("./output-parser");
const { classifyScanResult, classifyUpdateResult } = require("./result-classifier");

class WingetClient {
  constructor({ runner, executable = "winget.exe" }) {
    this.runner = runner;
    this.executable = executable;
  }

  async probe() {
    const result = await this.runner.run(this.executable, ["--version"], {
      timeoutMs: PROBE_TIMEOUT_MS,
      maxOutputBytes: 64 * 1024
    });
    return {
      available: result.code === 0 && !result.spawnError,
      version: result.code === 0 ? result.stdout.trim() : null,
      result
    };
  }

  async scan({ signal } = {}) {
    const args = [
      "upgrade",
      "--include-unknown",
      "--accept-source-agreements",
      "--disable-interactivity"
    ];
    const result = await this.runner.run(this.executable, args, {
      timeoutMs: SCAN_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      signal
    });
    const parsed = parseUpgradeOutput(`${result.stdout}\n${result.stderr}`);
    const classification = classifyScanResult(result, parsed);
    return { ...classification, packages: parsed.packages, warnings: parsed.warnings, diagnostic: diagnosticFrom(result) };
  }

  async update(pkg, { signal } = {}) {
    validatePackage(pkg);
    const args = [
      "upgrade",
      "--id", pkg.id,
      "--exact",
      "--source", pkg.source,
      "--silent",
      "--accept-source-agreements",
      "--accept-package-agreements",
      "--disable-interactivity"
    ];
    if (pkg.installedVersionUnknown) args.push("--include-unknown");
    const result = await this.runner.run(this.executable, args, {
      timeoutMs: UPDATE_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      signal
    });
    return { ...classifyUpdateResult(result), diagnostic: diagnosticFrom(result) };
  }
}

function validatePackage(pkg) {
  if (!pkg || !PACKAGE_ID_PATTERN.test(pkg.id || "")) throw codedError("invalid-package", "软件包 ID 无效");
  if (typeof pkg.source !== "string" || !pkg.source || pkg.source.length > 64 || /[\r\n\0]/.test(pkg.source)) {
    throw codedError("invalid-source", "软件源无效");
  }
}

function diagnosticFrom(result) {
  return `${result.stderr || ""}\n${result.stdout || ""}`.trim().slice(0, 2_000);
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { WingetClient, codedError, diagnosticFrom, validatePackage };
