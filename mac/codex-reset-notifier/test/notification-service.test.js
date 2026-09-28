const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { NotificationService } = require('../src/notification-service');
test('macOS uses Notification Center even when a custom toast is supplied', () => {
  const shown = [];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; }
    show() { shown.push(this); }
  }
  const service = new NotificationService({ Notification, platform: 'darwin', toast: { show() { throw new Error('custom toast must not be used'); } } });
  service.notify({ title: 'Codex 额度重置', eventType: '额度重置' });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].options.silent, false);
  assert.match(shown[0].options.body, /额度重置/);
  shown[0].emit('close');
  assert.equal(service.active.size, 0);
});
test('Windows keeps its existing custom toast', () => {
  let calls = 0;
  const service = new NotificationService({ platform: 'win32', toast: { show() { calls++; } } });
  service.notify({ eventType: '额度重置' }); assert.equal(calls, 1);
});
