const { getPackageIdentity } = require("../package-identity");
const { isUnknownVersion } = require("../winget/output-parser");

// Only order plain numeric versions. Vendor-specific versions are not semver.
function compareVersions(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return null;
  left = left.trim();
  right = right.trim();
  if (!left || !right || isUnknownVersion(left) || isUnknownVersion(right)) return null;
  if (left === right) return 0;
  const numeric = /^v?\d+(?:\.\d+)*$/i;
  if (!numeric.test(left) || !numeric.test(right)) return null;
  const a = left.replace(/^v/i, "").split(".").map(BigInt);
  const b = right.replace(/^v/i, "").split(".").map(BigInt);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0n) - (b[index] || 0n);
    if (diff !== 0n) return diff > 0n ? 1 : -1;
  }
  return 0;
}

function verifyPackage(original, result, originalSnapshotId) {
  const snapshot = result?.snapshot;
  if (!["ready", "partial"].includes(result?.status)
    || !["ready", "partial"].includes(snapshot?.status)
    || !snapshot.snapshotId || snapshot.snapshotId === originalSnapshotId
    || !Array.isArray(snapshot.packages)) return "unknown";
  if (original.appPath) {
    const installed = snapshot.installations?.find(app => app.appPath === original.appPath && app.bundleId === original.bundleId);
    if (!installed) return "unknown";
    const comparison = compareVersions(installed.build, original.availableBuild);
    return comparison === null ? "unknown" : comparison >= 0 ? "updated" : "pending";
  }
  const current = snapshot.packages.find(pkg => getPackageIdentity(pkg) === getPackageIdentity(original));
  if (!current) return (result.status === "ready" && snapshot.status === "ready") || (result.completeSources?.includes(original.source) && snapshot.completeSources?.includes(original.source)) ? "updated" : "unknown";
  if (current.installedVersionUnknown) return "unknown";
  const comparison = compareVersions(current.installedVersion, original.availableVersion);
  if (comparison === null) return "unknown";
  return comparison >= 0 ? "updated" : "pending";
}

module.exports = { compareVersions, verifyPackage };
