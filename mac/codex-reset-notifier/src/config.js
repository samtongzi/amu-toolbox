const RESET_EVENT_TYPES = new Set([
  "额度重置",
  "重置卡发放",
  "全量使用上限重置 + 额外重置次数",
  "全账号 usage limits 重置",
  "付费计划 rate limits 重置"
]);

module.exports = {
  API_URL: "https://divin.cc/api/reset-events",
  HOME_URL: "https://divin.cc/",
  POLL_INTERVAL_MS: 5 * 60 * 1000,
  REQUEST_TIMEOUT_MS: 15 * 1000,
  MAX_RESPONSE_BYTES: 1024 * 1024,
  RESET_EVENT_TYPES
};
