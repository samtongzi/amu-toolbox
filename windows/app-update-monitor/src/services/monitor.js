const { getPackageIdentity, parsePackageIdentity } = require("../package-identity");
const { scanFailureMessage } = require("./scan-service");

class Monitor {
  constructor({ scanService, stateStore, notifier, intervalMs, onState = () => {}, onLog = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.scanService = scanService;
    this.stateStore = stateStore;
    this.notifier = notifier;
    this.intervalMs = intervalMs;
    this.onState = onState;
    this.onLog = onLog;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.resumeTimer = null;
    this.stopped = true;
    this.state = null;
    this.inFlight = null;
    this.paused = false;
    this.mutationQueue = Promise.resolve();
  }

  async start() {
    this.state = await this.stateStore.load();
    this.stopped = false;
    await this.check("startup");
  }

  stop() {
    this.stopped = true;
    if (this.timer) this.clearTimer(this.timer);
    if (this.resumeTimer) this.clearTimer(this.resumeTimer);
    this.timer = null;
    this.resumeTimer = null;
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused && this.timer) this.clearTimer(this.timer);
    this.timer = null;
    if (!paused && !this.stopped) {
      this.timer = this.setTimer(() => void this.check("scheduled"), this.intervalMs);
    }
  }

  setIntervalMinutes(minutes) {
    this.intervalMs = minutes * 60_000;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    if (!this.stopped && !this.paused) {
      this.timer = this.setTimer(() => void this.check("scheduled"), this.intervalMs);
    }
  }

  scheduleAfterResume(delayMs = 3_000) {
    if (this.resumeTimer) this.clearTimer(this.resumeTimer);
    this.resumeTimer = this.setTimer(() => {
      this.resumeTimer = null;
      void this.check("resume");
    }, delayMs);
  }

  async check(reason = "manual") {
    if (this.inFlight || this.paused || this.stopped) return this.inFlight;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.onState({ scanStatus: "scanning", error: null });
    this.inFlight = this.scanService.scan({ reason })
      .then(async result => {
        if (result.status === "ready" || result.status === "partial") await this.updateNotificationBaseline(result.snapshot);
        this.onState({ scanStatus: result.status, lastScanResult: result,
          error: ["error", "cancelled"].includes(result.status) ? scanFailureMessage(result) : null });
        return result;
      })
      .catch(error => {
        this.onLog("error", "monitor", error.code || "scan-failed", error.message);
        this.onState({ scanStatus: "error", error: error.message });
        return { status: "error", code: error.code || "scan-failed", packages: [] };
      })
      .finally(() => {
        this.inFlight = null;
        if (!this.stopped && !this.paused) this.timer = this.setTimer(() => void this.check("scheduled"), this.intervalMs);
      });
    return this.inFlight;
  }

  async updateNotificationBaseline(snapshot) {
    const currentKeys = (snapshot?.packages || []).map(getPackageIdentity).filter(Boolean);
    const previous = new Set(this.state?.knownUpdateKeys || []);
    const ignored = new Set((this.state?.ignoredPackages || []).map(item => item.identity));
    const added = this.state?.initialized ? currentKeys.filter(key => !previous.has(key) && !ignored.has(key)) : [];
    await this.mutateState(state => ({
      ...state,
      initialized: true,
      lastSuccessfulScanAt: new Date().toISOString(),
      knownUpdateKeys: currentKeys
    }));
    if (this.state.settings.notificationsEnabled) {
      for (const key of added) this.notifier?.notify({ title: "发现应用更新", body: key });
    }
  }

  mutateState(mutator) {
    const operation = this.mutationQueue.then(async () => {
      const nextState = mutator(this.state);
      this.state = await this.stateStore.save(nextState);
      return this.getState();
    });
    this.mutationQueue = operation.catch(() => {});
    return operation;
  }

  updateSettings(settings) {
    return this.mutateState(state => ({ ...state, settings: { ...state.settings, ...settings } }));
  }

  ignorePackage(pkg) {
    const identity = getPackageIdentity(pkg);
    if (!identity) return Promise.reject(codedError("invalid-package", "软件标识无效"));
    return this.mutateState(state => ({
      ...state,
      ignoredPackages: [
        ...(state.ignoredPackages || []).filter(item => item.identity !== identity),
        {
          identity,
          source: pkg.source,
          id: pkg.id,
          name: pkg.name || pkg.id,
          ignoredAt: new Date().toISOString()
        }
      ]
    }));
  }

  restoreIgnored(identity) {
    const parsed = parsePackageIdentity(identity);
    if (!parsed) return Promise.reject(codedError("invalid-package-identity", "忽略项标识无效"));
    return this.mutateState(state => ({
      ...state,
      ignoredPackages: (state.ignoredPackages || []).filter(item => item.identity !== parsed.identity)
    }));
  }

  isPackageIgnored(pkg) {
    const identity = getPackageIdentity(pkg);
    return Boolean(identity && (this.state?.ignoredPackages || []).some(item => item.identity === identity));
  }

  filterIgnoredPackages(packages) {
    return (packages || []).filter(pkg => !this.isPackageIgnored(pkg));
  }

  getIgnoredPackages() {
    return this.getState()?.ignoredPackages || [];
  }

  getState() {
    return this.state ? JSON.parse(JSON.stringify(this.state)) : null;
  }
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { Monitor };
