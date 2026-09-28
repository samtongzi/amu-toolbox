const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
class AppIcons {
  constructor({ fallback = async () => null } = {}) { this.cache = new Map(); this.fallback = fallback; }
  async get(appPath) {
    let temp;
    try {
      const plist = path.join(appPath, 'Contents/Info.plist');
      const modified = (await fs.stat(plist)).mtimeMs;
      const key = appPath + ':' + modified;
      if (this.cache.has(key)) return this.cache.get(key);
      const { stdout } = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { timeout: 5000 });
      const info = JSON.parse(stdout);
      const name = info.CFBundleIconFile || info.CFBundleIcons?.CFBundlePrimaryIcon?.CFBundleIconFiles?.at(-1);
      if (typeof name !== 'string' || path.basename(name) !== name) throw new Error('No bundle icon');
      const resources = await fs.realpath(path.join(appPath, 'Contents/Resources'));
      const icon = await fs.realpath(path.join(resources, name.endsWith('.icns') ? name : name + '.icns'));
      if (!icon.startsWith(resources + path.sep)) throw new Error('Invalid bundle icon');
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'amu-icon-'));
      const output = path.join(temp, 'icon.png');
      await exec('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '128', icon, '--out', output], { timeout: 10000 });
      const bytes = await fs.readFile(output);
      if (bytes.length > 3 * 1024 * 1024) throw new Error('Icon too large');
      const data = 'data:image/png;base64,' + bytes.toString('base64');
      this.cache.set(key, data);
      return data;
    } catch { return this.fallback(appPath); }
    finally { if (temp) await fs.rm(temp, { recursive: true, force: true }).catch(() => {}); }
  }
}
module.exports = { AppIcons };
