const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { TrayController, formatTime } = require("../src/tray-controller");

class FakeTray extends EventEmitter {
  constructor() {
    super();
    this.menu = null;
    this.tooltip = null;
    this.popupCount = 0;
  }

  setToolTip(value) {
    this.tooltip = value;
  }

  setContextMenu(menu) {
    this.menu = menu;
  }

  popUpContextMenu() {
    this.popupCount += 1;
  }

  isDestroyed() {
    return false;
  }

  destroy() {}
}

function createController() {
  const tray = new FakeTray();
  const menus = [];
  const controller = new TrayController({
    Tray: class extends FakeTray {
      constructor(icon) {
        super(icon);
        Object.assign(this, tray);
      }
    },
    Menu: {
      buildFromTemplate(template) {
        menus.push(template);
        return { template };
      }
    },
    icon: {},
    shell: { openExternal: async () => {} },
    homeUrl: "https://divin.cc/",
    app: { quit() {} },
    onCheck() {},
    onToggleStartup() {}
  });
  return { controller, menus };
}

test("formats valid reset times and safe fallbacks", () => {
  assert.match(formatTime("2026-08-01T03:32:37.000Z", "暂无"), /08\/01/);
  assert.equal(formatTime(null, "暂无"), "暂无");
  assert.equal(formatTime("invalid", "暂无"), "暂无");
});

test("shows latest reset row in the disabled tray menu", () => {
  const { controller, menus } = createController();
  controller.setStatus({
    state: "monitoring",
    lastSuccessfulCheckAt: "2026-08-03T05:00:00.000Z",
    latestResetAt: "2026-08-01T03:32:37.000Z"
  });
  const row = menus.at(-1).find(item => item.label.startsWith("最近重置："));
  assert.ok(row);
  assert.equal(row.enabled, false);
  assert.match(row.label, /最近重置：08\/01/);
});

test("uses an empty label when no reset time is known", () => {
  const { controller, menus } = createController();
  const row = menus.at(-1).find(item => item.label.startsWith("最近重置："));
  assert.equal(row.label, "最近重置：尚未发现重置记录");
});

test("tray click opens the context menu", () => {
  const { controller } = createController();
  controller.tray.emit("click");
  assert.equal(controller.tray.popupCount, 1);
});
