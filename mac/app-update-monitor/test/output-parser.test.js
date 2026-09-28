const test = require("node:test");
const assert = require("node:assert/strict");
const { parseUpgradeOutput } = require("../src/winget/output-parser");

function row(name, id, installed, available, source = "winget") {
  return `${name.padEnd(25)}${id.padEnd(30)}${installed.padEnd(15)}${available.padEnd(15)}${source}`;
}

function table(rows) {
  return [
    row("Name", "Id", "Version", "Available", "Source"),
    `${"-".repeat(24)} ${"-".repeat(29)} ${"-".repeat(14)} ${"-".repeat(14)} ${"-".repeat(8)}`,
    ...rows
  ].join("\n");
}

test("parses fixed width winget rows with spaces in names", () => {
  const parsed = parseUpgradeOutput(table([
    row("Visual Studio Code", "Microsoft.VisualStudioCode", "1.90.0", "1.91.0")
  ]));
  assert.equal(parsed.hadTable, true);
  assert.equal(parsed.packages.length, 1);
  assert.equal(parsed.packages[0].name, "Visual Studio Code");
  assert.equal(parsed.packages[0].id, "Microsoft.VisualStudioCode");
});

test("rejects truncated and invalid package ids", () => {
  const parsed = parseUpgradeOutput(table([
    row("Broken App", "Vendor.App…", "1.0", "2.0"),
    row("Another App", "bad id", "1.0", "2.0")
  ]));
  assert.equal(parsed.packages.length, 0);
  assert.deepEqual(parsed.warnings.map(item => item.code), ["truncated-row", "invalid-package-id"]);
});

test("marks unknown installed version", () => {
  const parsed = parseUpgradeOutput(table([
    row("Unknown Tool", "Vendor.Tool", "未知", "2.0")
  ]));
  assert.equal(parsed.packages[0].installedVersionUnknown, true);
});

test("parses winget 1.29 continuous separator output from the right", () => {
  const parsed = parseUpgradeOutput([
    "名称                              ID                       版本       可用       源",
    "--------------------------------------------------------------------------------",
    "Microsoft Teams                   Microsoft.Teams          1.0.0.0    2.0.0      winget",
    "Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.42.34438 Microsoft.VCRedist.2015+.x64 14.42.34438.0 14.51.36247.0 winget",
    "剪映专业版                        ByteDance.JianyingPro     11.1.0     11.2.0     winget",
    "2 升级可用。"
  ].join("\n"));
  assert.equal(parsed.hadTable, true);
  assert.deepEqual(parsed.packages.map(pkg => pkg.id), ["Microsoft.Teams", "Microsoft.VCRedist.2015+.x64", "ByteDance.JianyingPro"]);
});
