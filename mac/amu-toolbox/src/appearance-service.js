const fs = require('node:fs/promises');
const path = require('node:path');
const MODES = ['light', 'dark', 'system'];

class AppearanceService {
  constructor({ nativeTheme, file, getWindow }) {
    Object.assign(this, { nativeTheme, file, getWindow });
    this.mode = 'system';
    this.pending = Promise.resolve();
    this.onUpdated = () => this.publish();
  }
  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (MODES.includes(saved.mode)) this.mode = saved.mode;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    this.nativeTheme.themeSource = this.mode;
    this.nativeTheme.on('updated', this.onUpdated);
  }
  snapshot() { return { mode: this.mode, dark: this.nativeTheme.shouldUseDarkColors }; }
  publish() {
    const window = this.getWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('appearance:changed', this.snapshot());
    }
  }
  setMode(mode) {
    if (!MODES.includes(mode)) return Promise.reject(new Error('请选择浅色、深色或跟随系统'));
    const task = this.pending.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(`${this.file}.tmp`, JSON.stringify({ mode }) + '\n', { mode: 0o600 });
      await fs.rename(`${this.file}.tmp`, this.file);
      this.mode = mode;
      this.nativeTheme.themeSource = mode;
      this.publish();
      return this.snapshot();
    });
    this.pending = task.catch(() => {});
    return task;
  }
  register(ipcMain) {
    const guard = (event, action) => {
      const contents = this.getWindow()?.webContents;
      if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) throw new Error('无效请求');
      return action();
    };
    ipcMain.handle('appearance:get', event => guard(event, () => this.snapshot()));
    ipcMain.handle('appearance:set', (event, mode) => guard(event, () => this.setMode(mode)));
  }
  dispose() { this.nativeTheme.removeListener('updated', this.onUpdated); }
}
module.exports = { AppearanceService };
