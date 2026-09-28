// Local UI fixtures only: never invokes winget or installs software.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "renderer");
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/fixture.js") {
    const status = ["failed", "ready"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "unverified";
    const pkg = { id: "Vendor.App", source: "winget", packageKey: "new-key", name: "示例应用", installedVersion: "1.0", availableVersion: "2.0" };
    const state = {
      revision: 1, winget: { available: true, version: "UI 测试" }, runtime: { scanStatus: "ready" },
      persisted: { settings: { scanIntervalMinutes: 60, maxConcurrentUpdates: 5 }, ignoredPackages: [] },
      snapshot: { snapshotId: "new", createdAt: new Date().toISOString(), status: "ready", packages: [pkg], warnings: [] },
      update: { runId: "test", status: "completed", total: 1, completed: 1, items: [{ ...pkg, packageKey: "old-key", status }] }, logs: []
    };
    if (status === "ready") {
      state.update = { status: "idle", items: [] };
      state.snapshot.packages = [
        ["Visual Studio Code", "Microsoft.VisualStudioCode", "1.102.0", "1.103.0"],
        ["Firefox", "Mozilla.Firefox", "141.0", "142.0"],
        ["微信", "Tencent.WeChat", "4.0.3", "4.0.5"],
        ["Notion", "Notion.Notion", "4.15.0", "4.16.0"]
      ].map(([name, id, installedVersion, availableVersion], index) => ({ name, id, installedVersion, availableVersion, source: "winget", packageKey: `preview-${index}` }));
      state.logs = [
        { message: "扫描完成，发现 4 个可更新应用", scope: "scan" },
        { message: "更新结果验证已就绪", scope: "update" },
        { message: "winget 已连接", scope: "winget" }
      ].map((entry, index) => ({ ...entry, id: `log-${index}`, level: "info", timestamp: new Date().toISOString() }));
    }
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.end(`const fixtureState = ${JSON.stringify(state)};
      let subscriber;
      window.appApi = {
        getState: async () => fixtureState,
        onStateChanged: callback => { subscriber = callback; }, onLogEntry: () => {},
        refresh: async () => {
          fixtureState.revision++;
          if (fixtureState.update.items[0]) fixtureState.update.items[0].status = 'succeeded';
          fixtureState.snapshot.packages = [];
          subscriber(fixtureState);
        }
      };`);
    return;
  }
  if (["/", "/index.html"].includes(url.pathname)) {
    const status = ["failed", "ready"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "unverified";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(fs.readFileSync(path.join(root, "index.html"), "utf8").replace('<script src="app.js"', `<script src="fixture.js?status=${status}"></script><script src="app.js"`));
    return;
  }
  const asset = { "/app.js": "text/javascript", "/styles.css": "text/css" }[url.pathname];
  if (!asset) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", `${asset}; charset=utf-8`);
  res.end(fs.readFileSync(path.join(root, url.pathname.slice(1))));
});
server.listen(18742, "127.0.0.1", () => console.log("UI fixtures: http://127.0.0.1:18742"));
