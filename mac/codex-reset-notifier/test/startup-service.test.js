const test = require('node:test');
const assert = require('node:assert/strict');
const { StartupService } = require('../src/startup-service');
test('Mac login settings omit Windows-only executable and arguments', () => {
  let saved;
  const app = { isPackaged: true, setLoginItemSettings: value => { saved = value; }, getLoginItemSettings: (...args) => { assert.equal(args.length, 0); return { openAtLogin: true }; } };
  const service = new StartupService({ app, platform: 'darwin' });
  assert.equal(service.setEnabled(true), true);
  assert.deepEqual(saved, { openAtLogin: true });
  assert.equal(service.getEnabled(), true);
  service.setEnabled(false); assert.deepEqual(saved, { openAtLogin: false });
});
test('development builds cannot register login startup', () => {
  const service = new StartupService({ app: { isPackaged: false }, platform: 'darwin' });
  assert.equal(service.setEnabled(true), false);
  assert.equal(service.getEnabled(), false);
});
