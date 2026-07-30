import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export function prepareDeclaredWritePath(repository, relativePath) {
  const root = realpathSync(repository);
  const rootLower = root.toLowerCase();
  const segments = relativePath.replaceAll("\\", "/").split("/");
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    if (existsSync(current)) {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Write path uses a symbolic link component: ${relativePath}`);
      if (!statSync(current).isDirectory()) throw new Error(`Write path parent is not a directory: ${relativePath}`);
    } else {
      mkdirSync(current);
    }
    const actual = realpathSync(current);
    if (actual.toLowerCase() !== current.toLowerCase()
      || (actual.toLowerCase() !== rootLower && !actual.toLowerCase().startsWith(`${rootLower}${path.sep}`))) {
      throw new Error(`Write path uses a linked parent: ${relativePath}`);
    }
  }
  const candidate = path.join(root, ...segments);
  if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
    throw new Error(`Write path is a symbolic link: ${relativePath}`);
  }
  return candidate;
}

function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
  }
}

export async function superviseProcess({
  command,
  args,
  cwd,
  prompt,
  timeoutMs,
  onStdout = () => {},
  onStderr = () => {},
  maxStdoutBytes = Number.POSITIVE_INFINITY,
  maxStderrBytes = Number.POSITIVE_INFINITY,
  reapDeadlineMs = 10_000,
  spawnImpl = spawn,
  terminateImpl = terminateProcessTree,
  signalSource = process,
}) {
  const child = spawnImpl(command, args, {
    cwd,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let timedOut = false;
  let interrupted = null;
  let outputLimitError = null;
  let reapTimer;
  let rejectUnreaped;
  const unreaped = new Promise((_, reject) => { rejectUnreaped = reject; });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  const requestTermination = (reason) => {
    if (reason === "timeout") timedOut = true;
    else interrupted = reason;
    terminateImpl(child);
    if (!reapTimer) {
      reapTimer = setTimeout(() => {
        const error = new Error(`Process tree was not reaped within ${reapDeadlineMs}ms after ${reason}`);
        error.code = "PROCESS_NOT_REAPED";
        error.childPid = child.pid ?? null;
        error.processGroup = child.pid == null ? null : (process.platform === "win32" ? child.pid : -child.pid);
        rejectUnreaped(error);
      }, reapDeadlineMs);
    }
  };
  const boundedOutput = (stream, callback, limit) => {
    if (limit !== Number.POSITIVE_INFINITY
      && (!Number.isSafeInteger(limit) || limit <= 0)) {
      throw new Error(`${stream} output limit must be a positive integer`);
    }
    let received = 0;
    return (value) => {
      if (outputLimitError) return;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const remaining = limit - received;
      if (chunk.length <= remaining) {
        received += chunk.length;
        callback(chunk);
        return;
      }
      if (remaining > 0) callback(chunk.subarray(0, remaining));
      received += chunk.length;
      const error = new Error(`Process ${stream} exceeded ${limit} bytes`);
      error.code = "PROCESS_OUTPUT_LIMIT";
      error.stream = stream;
      error.limitBytes = limit;
      error.receivedBytes = received;
      outputLimitError = error;
      requestTermination(`${stream}-limit`);
    };
  };
  child.stdout.on("data", boundedOutput("stdout", onStdout, maxStdoutBytes));
  child.stderr.on("data", boundedOutput("stderr", onStderr, maxStderrBytes));
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
  const onSigint = () => requestTermination("SIGINT");
  const onSigterm = () => requestTermination("SIGTERM");
  signalSource.once("SIGINT", onSigint);
  signalSource.once("SIGTERM", onSigterm);
  const timeout = setTimeout(() => requestTermination("timeout"), timeoutMs);
  try {
    const exitCode = await Promise.race([completion, unreaped]);
    if (outputLimitError) throw outputLimitError;
    return { exitCode, timedOut, interrupted, pid: child.pid ?? null };
  } finally {
    clearTimeout(timeout);
    if (reapTimer) clearTimeout(reapTimer);
    signalSource.removeListener("SIGINT", onSigint);
    signalSource.removeListener("SIGTERM", onSigterm);
  }
}
