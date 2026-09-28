const { spawn } = require("child_process");

class ProcessRunner {
  constructor({ spawnProcess = spawn, killProcessTree, defaultMaxOutputBytes = 16 * 1024 * 1024 } = {}) {
    this.spawnProcess = spawnProcess;
    this.killProcessTree = killProcessTree || defaultKillProcessTree;
    this.defaultMaxOutputBytes = defaultMaxOutputBytes;
  }

  run(file, args, { timeoutMs, maxOutputBytes = this.defaultMaxOutputBytes, signal, onStarted, env } = {}) {
    return new Promise(resolve => {
      let child;
      try {
        child = this.spawnProcess(file, args, {
          windowsHide: true,
          detached: process.platform !== "win32",
          ...(env ? { env } : {}),
          shell: false,
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (error) {
        resolve(emptyFailure("spawnError", error));
        return;
      }

      onStarted?.(child.pid);
      const output = { stdout: [], stderr: [] };
      let outputBytes = 0;
      let settled = false;
      let timedOut = false;
      let cancelled = false;
      let outputTooLarge = false;
      let spawnError = null;
      let terminating = false;

      const finish = (code, terminationSignal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve({
          code: Number.isInteger(code) ? code : null,
          signal: terminationSignal || null,
          stdout: Buffer.concat(output.stdout).toString("utf8"),
          stderr: Buffer.concat(output.stderr).toString("utf8"),
          timedOut,
          cancelled,
          outputTooLarge,
          spawnError
        });
      };

      const terminate = reason => {
        if (settled || terminating) return;
        terminating = true;
        if (reason === "timeout") timedOut = true;
        if (reason === "cancel") cancelled = true;
        if (reason === "output") outputTooLarge = true;
        void Promise.resolve(this.killProcessTree(child.pid)).catch(() => {}).finally(() => {
          setTimeout(() => finish(null, reason), 1_000).unref?.();
        });
      };

      const collect = target => chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        outputBytes += buffer.length;
        if (outputBytes > maxOutputBytes) {
          terminate("output");
          return;
        }
        output[target].push(buffer);
      };

      child.stdout?.on("data", collect("stdout"));
      child.stderr?.on("data", collect("stderr"));
      child.on("error", error => {
        spawnError = error;
      });
      child.on("close", finish);

      const abort = () => terminate("cancel");
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const timer = timeoutMs ? setTimeout(() => terminate("timeout"), timeoutMs) : null;
      timer?.unref?.();
    });
  }
}

function emptyFailure(field, error) {
  return {
    code: null,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    cancelled: false,
    outputTooLarge: false,
    spawnError: field === "spawnError" ? error : null
  };
}

function defaultKillProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve();
  if (process.platform !== "win32") {
    // Each command is spawned in its own process group, including its children.
    try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      shell: false,
      stdio: "ignore"
    });
    killer.once("close", resolve);
    killer.once("error", resolve);
  });
}

module.exports = { ProcessRunner, defaultKillProcessTree };
