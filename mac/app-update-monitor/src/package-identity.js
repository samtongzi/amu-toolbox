const MAX_PACKAGE_PART_LENGTH = 256;
const MAX_PACKAGE_IDENTITY_LENGTH = (MAX_PACKAGE_PART_LENGTH * 2) + 1;

function normalizePackagePart(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > MAX_PACKAGE_PART_LENGTH || normalized.includes("\0")) return null;
  return normalized;
}

function getPackageIdentity(pkg) {
  const source = normalizePackagePart(pkg?.source);
  const id = normalizePackagePart(pkg?.id);
  return source && id ? `${source}\0${id}` : null;
}

function parsePackageIdentity(value) {
  if (typeof value !== "string" || value.length > MAX_PACKAGE_IDENTITY_LENGTH) return null;
  const separator = value.indexOf("\0");
  if (separator < 1 || separator !== value.lastIndexOf("\0")) return null;
  const source = normalizePackagePart(value.slice(0, separator));
  const id = normalizePackagePart(value.slice(separator + 1));
  return source && id ? { identity: `${source}\0${id}`, source, id } : null;
}

function normalizeStoredIdentity(value) {
  const parsed = parsePackageIdentity(value);
  if (parsed) return parsed.identity;
  if (typeof value !== "string") return null;
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  return getPackageIdentity({ source: value.slice(0, separator), id: value.slice(separator + 1) });
}

module.exports = {
  MAX_PACKAGE_IDENTITY_LENGTH,
  getPackageIdentity,
  normalizePackagePart,
  normalizeStoredIdentity,
  parsePackageIdentity
};
