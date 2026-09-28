const { HOME_URL, RESET_EVENT_TYPES } = require("./config");

function hasValidId(event) {
  return typeof event?.id === "string" && event.id.trim().length > 0;
}

function isResetEvent(event) {
  return hasValidId(event)
    && event.tool === "codex"
    && RESET_EVENT_TYPES.has(event.eventType);
}

function getSafeSourceUrl(event) {
  try {
    const url = new URL(event?.sourceUrl);
    return url.protocol === "https:" ? url.href : HOME_URL;
  } catch {
    return HOME_URL;
  }
}

function getEventTime(event) {
  for (const value of [event?.sortTime, event?.eventTimeUtc]) {
    const timestamp = Date.parse(value || "");
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  return 0;
}

module.exports = { getEventTime, getSafeSourceUrl, hasValidId, isResetEvent };
