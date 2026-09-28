const { getEventTime, hasValidId, isResetEvent } = require("./event-filter");

class Monitor {
  constructor({ apiClient, stateStore, notifier, intervalMs, onStatus = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.apiClient = apiClient;
    this.stateStore = stateStore;
    this.notifier = notifier;
    this.intervalMs = intervalMs;
    this.onStatus = onStatus;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.state = null;
    this.inFlight = null;
    this.timer = null;
    this.stopped = true;
    this.stateMutationQueue = Promise.resolve();
  }

  async start() {
    this.state = await this.stateStore.load();
    this.stopped = false;
    await this.check();
  }

  stop() {
    this.stopped = true;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }

  setOpenAtLogin(enabled) {
    return this.updateState(state => ({
      ...state,
      settings: { ...state.settings, openAtLogin: enabled, startupConfigured: true }
    }));
  }

  updateState(mutator) {
    const operation = this.stateMutationQueue.then(async () => {
      if (!this.state) this.state = await this.stateStore.load();
      this.state = await this.stateStore.save(mutator(this.state));
      return this.state;
    });
    this.stateMutationQueue = operation.catch(() => {});
    return operation;
  }

  check() {
    if (this.inFlight) return this.inFlight;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.inFlight = this.runCheck().finally(() => {
      this.inFlight = null;
      if (!this.stopped) this.timer = this.setTimer(() => this.check(), this.intervalMs);
    });
    return this.inFlight;
  }

  async runCheck() {
    this.onStatus({
      state: "checking",
      lastSuccessfulCheckAt: this.state?.lastSuccessfulCheckAt,
      latestResetAt: this.state?.latestResetAt
    });

    try {
      const events = await this.apiClient.fetchEvents();
      const uniqueEvents = [];
      const responseIds = new Set();
      for (const event of events) {
        if (!hasValidId(event) || responseIds.has(event.id)) continue;
        responseIds.add(event.id);
        uniqueEvents.push(event);
      }

      const checkedAt = new Date().toISOString();
      const latestFetchedResetTime = uniqueEvents
        .filter(isResetEvent)
        .reduce((latest, event) => Math.max(latest, getEventTime(event)), 0);
      let alerts = [];
      await this.updateState(state => {
        const seenIds = new Set(state.seenEventIds);
        const newEvents = uniqueEvents.filter(event => !seenIds.has(event.id));
        for (const event of newEvents) seenIds.add(event.id);
        alerts = state.initialized
          ? newEvents.filter(isResetEvent).sort((a, b) => getEventTime(a) - getEventTime(b))
          : [];
        const storedResetTime = Date.parse(state.latestResetAt || "");
        const latestResetTime = Math.max(
          Number.isNaN(storedResetTime) ? 0 : storedResetTime,
          latestFetchedResetTime
        );
        return {
          ...state,
          initialized: true,
          seenEventIds: [...seenIds],
          lastSuccessfulCheckAt: checkedAt,
          latestResetAt: latestResetTime ? new Date(latestResetTime).toISOString() : null
        };
      });
      for (const event of alerts) this.notifier.notify(event);

      this.onStatus({
        state: "monitoring",
        lastSuccessfulCheckAt: this.state.lastSuccessfulCheckAt,
        latestResetAt: this.state.latestResetAt
      });
      return { ok: true };
    } catch (error) {
      this.onStatus({
        state: "error",
        error: error instanceof Error ? error.message : String(error),
        lastSuccessfulCheckAt: this.state?.lastSuccessfulCheckAt,
        latestResetAt: this.state?.latestResetAt
      });
      return { ok: false, error };
    }
  }
}

module.exports = { Monitor };
