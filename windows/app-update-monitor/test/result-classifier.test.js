const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyScanResult, classifyUpdateResult, formatExitCode } = require("../src/winget/result-classifier");

const base = { code: 0, stdout: "", stderr: "", cancelled: false, timedOut: false, outputTooLarge: false, spawnError: null };

test("classifies nonzero scan with packages as partial", () => {
  const result = classifyScanResult({ ...base, code: 22 }, { packages: [{ id: "A.B" }], warnings: [], hadTable: true });
  assert.equal(result.status, "partial");
});

test("does not confuse parse failure with empty list", () => {
  const result = classifyScanResult(base, { packages: [], warnings: [{ code: "bad" }], hadTable: true });
  assert.equal(result.code, "parse-error");
});

test("recognizes localized no-updates output", () => {
  const result = classifyScanResult({ ...base, stdout: "没有可用的升级" }, { packages: [], warnings: [], hadTable: false });
  assert.equal(result.status, "ready");
  assert.equal(result.code, "no-updates");
});

test("recognizes the actual winget 1.29 Chinese empty upgrade response", () => {
  const result = classifyScanResult({ ...base, stdout: "找不到与输入条件匹配的已安装程序包。\r\n" }, { packages: [], warnings: [], hadTable: false });
  assert.equal(result.status, "ready");
  assert.equal(result.code, "no-updates");
});

test("Chinese empty response does not hide source failure or timeout", () => {
  const stdout = "找不到与输入条件匹配的已安装程序包。";
  const parsed = { packages: [], warnings: [], hadTable: false };
  assert.equal(classifyScanResult({ ...base, stdout, stderr: "打开源失败" }, parsed).code, "source-error");
  assert.equal(classifyScanResult({ ...base, stdout, timedOut: true }, parsed).code, "scan-timeout");
});

test("unknown output with code zero is still an error", () => {
  assert.equal(classifyScanResult(base, { packages: [], warnings: [], hadTable: false }).status, "error");
});

test("formats Windows exit codes", () => {
  assert.deepEqual(formatExitCode(-1978335212), { signed: -1978335212, unsigned: 2316632084, hex: "0x8A150014" });
});

test("classifies cancelled update", () => {
  assert.equal(classifyUpdateResult({ ...base, cancelled: true }).code, "update-cancelled");
});

test("source errors take precedence over no-updates text", () => {
  const result = classifyScanResult({ ...base, code: 1, stdout: "Failed when opening source: msstore\nNo applicable upgrade found" }, { packages: [], warnings: [], hadTable: false });
  assert.equal(result.status, "error");
  assert.equal(result.code, "source-error");
});

test("source errors make a populated scan partial even with exit code zero", () => {
  const result = classifyScanResult({ ...base, stderr: "Failed when opening source" }, { packages: [{ id: "A.B" }], warnings: [], hadTable: true });
  assert.equal(result.status, "partial");
});
