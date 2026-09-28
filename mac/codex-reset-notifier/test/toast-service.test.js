const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { ToastService, toastBounds } = require("../src/toast-service");

function harness() {
  const windows = [], timers = new Map(), opened = [], fallbacks = [];
  let timerId = 0;
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
      windows.push(this);
    }
    setMenu() {}
    loadFile() { return Promise.resolve(); }
    setBounds(bounds) { this.bounds = bounds; }
    showInactive() { this.visible = true; }
    isDestroyed() { return !!this.destroyed; }
    destroy() { this.destroyed = true; this.emit("closed"); }
  }
  const ipcMain = new EventEmitter(), screen = new EventEmitter();
  screen.getPrimaryDisplay = () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } });
  const service = new ToastService({ BrowserWindow: Window, ipcMain, screen,
    shell: { beep() {}, openExternal: async url => opened.push(url) },
    setTimer: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimer: id => timers.delete(id)
  });
  const action = (name, value) => {
    const sender = service.current.window.webContents;
    ipcMain.emit("toast:action", { sender, senderFrame: sender.mainFrame }, name, value);
  };
  const show = id => service.show({ title: id }, () => fallbacks.push(id));
  return { service, windows, timers, ipcMain, screen, opened, fallbacks, action, show };
}

test("compact toast stays inside the usable screen, including a monitor to the left", () => {
  assert.deepEqual(toastBounds({ x: -1920, y: 40, width: 1920, height: 1000 }, 158),
    { x: -376, y: 866, width: 360, height: 158 });
  const bounds = toastBounds({ x: 0, y: 0, width: 320, height: 480 }, 900);
  assert.deepEqual(bounds, { x: 16, y: 184, width: 288, height: 280 });
});

test("multiple reset events are queued and shown one at a time without stealing focus", () => {
  const h = harness(); h.show("first"); h.show("second");
  assert.equal(h.windows.length, 1);
  assert.equal(h.windows[0].visible, undefined);
  h.action("ready", 150);
  assert.equal(h.windows[0].visible, true);
  assert.equal(h.windows[0].options.skipTaskbar, true);
  h.action("close");
  assert.equal(h.windows[0].destroyed, true);
  assert.equal(h.windows.length, 2);
  assert.equal(h.service.current.event.title, "second");
  h.service.destroy();
});

test("hover pause cancels dismissal and leaving grants a fresh reading interval", () => {
  const h = harness(); h.show("event"); h.action("ready", 140);
  assert.equal([...h.timers.values()][0].ms, 12000);
  h.action("pause"); assert.equal(h.timers.size, 0);
  h.action("resume"); assert.equal(h.timers.size, 1);
  [...h.timers.values()][0].fn();
  assert.equal(h.service.current, null);
  assert.equal(h.timers.size, 0);
});

test("failed rendering falls back exactly once and continues the queue", () => {
  const h = harness(); h.show("first"); h.show("second");
  const failed = h.service.current;
  [...h.timers.values()][0].fn();
  h.service.fail(failed);
  assert.deepEqual(h.fallbacks, ["first"]);
  assert.equal(h.service.current.event.title, "second");
  h.service.destroy();
});

test("renderer crashes after display still use the native notification fallback", () => {
  const h = harness(); h.show("event"); h.action("ready", 140);
  h.windows[0].webContents.emit("render-process-gone");
  assert.deepEqual(h.fallbacks, ["event"]);
  assert.equal(h.service.current, null);
});

test("unrelated frames cannot dismiss or open notification sources", () => {
  const h = harness(); h.show("event"); h.action("ready", 140);
  const sender = h.service.current.window.webContents;
  h.ipcMain.emit("toast:action", { sender, senderFrame: {} }, "close");
  h.ipcMain.emit("toast:action", { sender: {}, senderFrame: {} }, "open");
  assert.ok(h.service.current);
  assert.deepEqual(h.opened, []);
  h.service.destroy();
});

test("source click sanitizes unsafe URLs and suppresses repeated opens", async () => {
  const h = harness();
  h.service.show({ sourceUrl: "javascript:alert(1)" }, () => {});
  h.action("ready", 150);
  h.action("open"); h.action("open");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.opened, ["https://divin.cc/"]);
  assert.equal(h.service.current, null);
  h.service.destroy();
});

test("display changes reposition visible cards and shutdown clears timers and listeners", () => {
  const h = harness(); h.show("first"); h.show("second"); h.action("ready", 150);
  h.screen.getPrimaryDisplay = () => ({ workArea: { x: 0, y: 0, width: 1280, height: 680 } });
  h.screen.emit("display-metrics-changed");
  assert.equal(h.windows[0].bounds.y, 514);
  h.service.destroy();
  assert.equal(h.windows.length, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.ipcMain.listenerCount("toast:action"), 0);
  assert.equal(h.screen.listenerCount("display-metrics-changed"), 0);
});
