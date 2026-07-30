import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

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
  child.stdout.on("data", onStdout);
  child.stderr.on("data", onStderr);
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);

  let timedOut = false;
  let interrupted = null;
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
        rejectUnreaped(error);
      }, reapDeadlineMs);
    }
  };
  const onSigint = () => requestTermination("SIGINT");
  const onSigterm = () => requestTermination("SIGTERM");
  signalSource.once("SIGINT", onSigint);
  signalSource.once("SIGTERM", onSigterm);
  const timeout = setTimeout(() => requestTermination("timeout"), timeoutMs);
  try {
    const exitCode = await Promise.race([completion, unreaped]);
    return { exitCode, timedOut, interrupted, pid: child.pid ?? null };
  } finally {
    clearTimeout(timeout);
    if (reapTimer) clearTimeout(reapTimer);
    signalSource.removeListener("SIGINT", onSigint);
    signalSource.removeListener("SIGTERM", onSigterm);
  }
}
