class FakeWingetClient {
  constructor() {
    this.calls = [];
    this.activeUpdates = 0;
    this.packages = [
      { name: "示例编辑器", id: "Contoso.Editor", installedVersion: "1.0.0", availableVersion: "1.1.0", source: "winget", installedVersionUnknown: false },
      { name: "示例工具", id: "Contoso.Tools", installedVersion: "未知", availableVersion: "2.0.0", source: "winget", installedVersionUnknown: true },
      { name: "示例浏览器", id: "Contoso.Browser", installedVersion: "4.2.0", availableVersion: "4.5.0", source: "winget", installedVersionUnknown: false },
      { name: "示例播放器", id: "Contoso.Player", installedVersion: "3.0.0", availableVersion: "3.2.0", source: "winget", installedVersionUnknown: false },
      { name: "示例压缩工具", id: "Contoso.Archiver", installedVersion: "8.0.0", availableVersion: "8.1.0", source: "winget", installedVersionUnknown: false },
      { name: "示例终端", id: "Contoso.Terminal", installedVersion: "2.3.0", availableVersion: "2.4.0", source: "winget", installedVersionUnknown: false }
    ];
  }

  async probe() { return { available: true, version: "v1.9.0-mock" }; }

  async scan() {
    return { status: "ready", code: "mock-scan", packages: this.packages, warnings: [], diagnostic: "" };
  }

  async update(pkg, { signal } = {}) {
    this.calls.push({ type: "update", pkg });
    this.activeUpdates += 1;
    try {
      await wait(900, signal);
      if (pkg.id === "Contoso.Tools") return { ok: false, code: "mock-failure", diagnostic: "模拟失败：请稍后重试" };
      this.packages = this.packages.filter(item => item.id !== pkg.id);
      return { ok: true, code: "command-completed", diagnostic: "" };
    } catch {
      return { ok: false, code: "update-cancelled", diagnostic: "已取消" };
    } finally {
      this.activeUpdates -= 1;
    }
  }
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    }, { once: true });
  });
}

module.exports = { FakeWingetClient };
