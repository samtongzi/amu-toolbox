const test = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions, verifyPackage } = require("../src/services/update-verification");

const original = { id: "Vendor.App", source: "winget", installedVersion: "1.0", availableVersion: "2.0" };
function scan(packages, status = "ready") {
  return { status, snapshot: { snapshotId: "new", status, packages } };
}

test("compares numeric versions without assuming all vendor versions are semver", () => {
  assert.equal(compareVersions("v2.0.0.0", "2.0"), 0);
  assert.equal(compareVersions("2.10", "2.9"), 1);
  assert.equal(compareVersions("1.9", "2"), -1);
  assert.equal(compareVersions("2.0-beta", "2.0"), null);
  assert.equal(compareVersions("release-x", "release-x"), 0);
  assert.equal(compareVersions("Unknown", "2"), null);
});

test("rejects stale results and cannot infer success from an incomplete list", () => {
  assert.equal(verifyPackage(original, scan([], "partial"), "old"), "unknown");
  assert.equal(verifyPackage(original, scan([]), "new"), "unknown");
  assert.equal(verifyPackage(original, { ...scan([]), status: "error" }, "old"), "unknown");
  assert.equal(verifyPackage(original, { status: "ready", snapshot: { snapshotId: "new", status: "stale", packages: [] } }, "old"), "unknown");
  assert.equal(verifyPackage(original, scan([]), "old"), "updated");
});

test("recognizes target version even when a newer update is available", () => {
  const current = { ...original, source: "WinGet", id: "vendor.app", installedVersion: "2.0.0", availableVersion: "3.0" };
  assert.equal(verifyPackage(original, scan([current], "partial"), "old"), "updated");
  assert.equal(verifyPackage(original, scan([original]), "old"), "pending");
  assert.equal(verifyPackage(original, scan([{ ...current, installedVersionUnknown: true }]), "old"), "unknown");
});

test('a complete Homebrew rescan can verify updates when a different website source fails', () => {
  const pkg = { ...original, source: 'homebrew-cask' };
  const result = scan([], 'partial');
  result.completeSources = ['homebrew-cask'];
  result.snapshot.completeSources = ['homebrew-cask'];
  assert.equal(verifyPackage(pkg, result, 'old'), 'updated');
  assert.equal(verifyPackage(original, result, 'old'), 'unknown');
  result.snapshot.completeSources = [];
  assert.equal(verifyPackage(pkg, result, 'old'), 'unknown');
});
