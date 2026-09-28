const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { AppearanceService } = require('../src/appearance-service');
class Theme extends EventEmitter {
  themeSource = 'system';
  systemDark = false;
  get shouldUseDarkColors() { return this.themeSource === 'dark' || (this.themeSource === 'system' && this.systemDark); }
}
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amu-appearance-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sent = [], nativeTheme = new Theme();
  const webContents = { mainFrame: {}, isDestroyed: () => false, send: (_channel, state) => sent.push(state) };
  const args = { nativeTheme, file: path.join(dir, 'appearance.json'), getWindow: () => ({ isDestroyed: () => false, webContents }) };
  const service = new AppearanceService(args);
  await service.load();
  t.after(() => service.dispose());
  return { service, args, sent, webContents };
}
test('appearance persists across restarts and serializes rapid changes', async t => {
  const { service, args } = await setup(t);
  await Promise.all([service.setMode('dark'), service.setMode('light')]);
  assert.deepEqual(service.snapshot(), { mode: 'light', dark: false });
  const restarted = new AppearanceService(args);
  await restarted.load();
  assert.deepEqual(restarted.snapshot(), { mode: 'light', dark: false });
  restarted.dispose();
  await assert.rejects(service.setMode('unexpected'), /请选择/);
  assert.equal(JSON.parse(await fs.readFile(args.file)).mode, 'light');
});
test('system appearance tracks OS events while explicit modes remain fixed', async t => {
  const { service, args, sent } = await setup(t);
  args.nativeTheme.systemDark = true;
  args.nativeTheme.emit('updated');
  assert.deepEqual(sent.at(-1), { mode: 'system', dark: true });
  await service.setMode('light');
  args.nativeTheme.emit('updated');
  assert.deepEqual(sent.at(-1), { mode: 'light', dark: false });
  await service.setMode('system');
  args.nativeTheme.systemDark = false;
  args.nativeTheme.emit('updated');
  assert.deepEqual(sent.at(-1), { mode: 'system', dark: false });
});
test('appearance IPC rejects other windows and subframes', async t => {
  const { service, webContents } = await setup(t);
  const handlers = {};
  service.register({ handle: (channel, handler) => { handlers[channel] = handler; } });
  const valid = { sender: webContents, senderFrame: webContents.mainFrame };
  assert.deepEqual(handlers['appearance:get'](valid), { mode: 'system', dark: false });
  assert.throws(() => handlers['appearance:set']({ ...valid, senderFrame: {} }, 'dark'), /无效/);
  assert.throws(() => handlers['appearance:set']({ ...valid, sender: {} }, 'dark'), /无效/);
  assert.deepEqual(await handlers['appearance:set'](valid, 'dark'), { mode: 'dark', dark: true });
});
