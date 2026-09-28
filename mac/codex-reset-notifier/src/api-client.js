class ApiClient {
  constructor({ fetcher, url, timeoutMs, maxResponseBytes }) {
    this.fetcher = fetcher;
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
  }

  async fetchEvents() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const separator = this.url.includes("?") ? "&" : "?";
      const response = await this.fetcher(`${this.url}${separator}t=${Date.now()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`);

      const contentLength = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(contentLength) && contentLength > this.maxResponseBytes) {
        throw new Error("接口响应过大");
      }

      let bytes;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let totalBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            totalBytes += chunk.length;
            if (totalBytes > this.maxResponseBytes) {
              await reader.cancel();
              throw new Error("接口响应过大");
            }
            chunks.push(chunk);
          }
        } finally {
          reader.releaseLock();
        }
        bytes = Buffer.concat(chunks, totalBytes);
      } else {
        bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > this.maxResponseBytes) throw new Error("接口响应过大");
      }

      let data;
      try {
        data = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new Error("接口返回了无效 JSON");
      }

      if (!Array.isArray(data)) throw new Error("接口数据格式不正确");
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { ApiClient };
