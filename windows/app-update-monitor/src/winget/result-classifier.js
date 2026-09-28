const NO_UPDATES_PATTERNS = [
  /No applicable upgrade found/i,
  /No installed package found matching input criteria/i,
  /^\s*找不到与输入条件匹配的已安装程序包[。.]?\s*$/m,
  /没有可用的升级/i,
  /没有找到适用的升级/i
];
const MULTIPLE_MATCH_PATTERNS = [/Multiple installed packages found/i, /找到多个与输入标准匹配的已安装程序包/i];
const SOURCE_ERROR_PATTERNS = [/Failed when opening source/i, /源.*(?:失败|不可用|错误)/i];

function hasAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function formatExitCode(code) {
  if (!Number.isInteger(code)) return { signed: code ?? null, unsigned: null, hex: null };
  const unsigned = code >>> 0;
  return { signed: code, unsigned, hex: `0x${unsigned.toString(16).toUpperCase().padStart(8, "0")}` };
}

function classifyScanResult(result, parsed) {
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  const exitCode = formatExitCode(result.code);
  if (result.cancelled) return { status: "cancelled", code: "scan-cancelled", exitCode };
  if (result.timedOut) return { status: "error", code: "scan-timeout", exitCode };
  if (result.outputTooLarge) return { status: "error", code: "output-too-large", exitCode };
  if (result.spawnError) return { status: "error", code: "winget-unavailable", exitCode };
  if (parsed.packages.length > 0) {
    return {
      status: result.code === 0 && parsed.warnings.length === 0 && !hasAny(text, SOURCE_ERROR_PATTERNS) ? "ready" : "partial",
      code: result.code === 0 ? "scan-completed" : "winget-partial",
      exitCode
    };
  }
  if (hasAny(text, SOURCE_ERROR_PATTERNS)) return { status: "error", code: "source-error", exitCode };
  if (parsed.hadTable) return { status: "error", code: "parse-error", exitCode };
  if (hasAny(text, MULTIPLE_MATCH_PATTERNS)) return { status: "error", code: "multiple-matches", exitCode };
  if (hasAny(text, NO_UPDATES_PATTERNS)) return { status: "ready", code: "no-updates", exitCode };
  return { status: "error", code: "winget-failed", exitCode };
}

function classifyUpdateResult(result) {
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  const exitCode = formatExitCode(result.code);
  if (result.cancelled) return { ok: false, code: "update-cancelled", exitCode };
  if (result.timedOut) return { ok: false, code: "update-timeout", exitCode };
  if (result.outputTooLarge) return { ok: false, code: "output-too-large", exitCode };
  if (result.spawnError) return { ok: false, code: "winget-unavailable", exitCode };
  if (hasAny(text, MULTIPLE_MATCH_PATTERNS)) return { ok: false, code: "multiple-matches", exitCode };
  if (hasAny(text, SOURCE_ERROR_PATTERNS)) return { ok: false, code: "source-error", exitCode };
  if (result.code === 0) return { ok: true, code: "command-completed", exitCode };
  return { ok: false, code: "update-failed", exitCode };
}

module.exports = { classifyScanResult, classifyUpdateResult, formatExitCode };
