// Exercises real offline packages and Windows shortcuts in an isolated directory.
const { app, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { Library } = require("../src/library");
const platform = require("../src/windows-platform");
const catalog = require("../catalog.json").apps;
app.whenReady().then(async () => {
  const release = path.join(__dirname, "../release");
  await fs.mkdir(release, { recursive: true });
  const root = await fs.mkdtemp(path.join(release, "smoke-"));
  const lib = new Library({ catalog, packageRoot: path.join(__dirname, "../packages"), installRoot: path.join(root, "apps"), shortcutsRoot: path.join(root, "shortcuts"), shell, platform });
  const results = [];
  for (const item of catalog) {
    await lib.install(item.id);
    const installed = await lib.installed(item);
    assert.equal(installed.version, item.version);
    assert.equal(crypto.createHash("sha256").update(await fs.readFile(installed.path)).digest("hex"), item.sha256);
    assert.equal(shell.readShortcutLink(lib.shortcut(item.id)).target, installed.path);
    const exported = path.join(root, `export-${item.file}`);
    await lib.exportPackage(item.id, exported);
    assert.equal(crypto.createHash("sha256").update(await fs.readFile(exported)).digest("hex"), item.sha256);
    await lib.uninstall(item.id);
    assert.equal(await lib.installed(item), null);
    await assert.rejects(fs.stat(lib.shortcut(item.id)), { code: "ENOENT" });
    await fs.unlink(exported);
    results.push({ name: item.name, version: item.version, install: true, shortcut: true, export: true, uninstall: true });
  }
  await fs.writeFile(path.join(release, "smoke-results.json"), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify(results));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
