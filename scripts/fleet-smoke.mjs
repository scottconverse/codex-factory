#!/usr/bin/env node
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { summarizeUsage } from "./run-worker.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_SOURCE = readFileSync(path.join(ROOT, "package.json"), "utf8");
const CONFIG_SOURCE = readFileSync(path.join(ROOT, "factory.config.json"), "utf8");
const CONFIG = JSON.parse(CONFIG_SOURCE);
const TASKS = [
  {
    id: "package",
    prompt: `You are one read-only leaf worker in a two-worker smoke test.
Do not delegate, call tools, edit files, or discuss your process.
Use the supplied package.json source below.
Return exactly one raw JSON object with keys task, name, and version.
Set task to "package". Set name and version to the values in the supplied source.
Do not use Markdown fences or add any other text.

package.json:
${PACKAGE_SOURCE}`,
  },
  {
    id: "config",
    prompt: `You are one read-only leaf worker in a two-worker smoke test.
Do not delegate, call tools, edit files, or discuss your process.
Use the supplied factory.config.json source below.
Return exactly one raw JSON object with keys task, maxConcurrentWorkers, discoverOllama, and configuredCodexCandidates.
Set task to "config". Read maxConcurrentWorkers from budgets, discoverOllama from candidates.ollama.discover, and configuredCodexCandidates as the length of candidates.openai.
Do not use Markdown fences or add any other text.

factory.config.json:
${CONFIG_SOURCE}`,
  },
];

export function workersOverlap(results) {
  if (results.length < 2) return false;
  const latestStart = Math.max(...results.map((result) => result.startedAtMs));
  const earliestFinish = Math.min(...results.map((result) => result.finishedAtMs));
  return latestStart < earliestFinish;
}

export function validateSmokeArtifact(taskId, text) {
  const artifact = JSON.parse(text);
  if (taskId === "package") {
    if (artifact.task !== "package" || artifact.name !== "codex-factory" || artifact.version !== "0.1.0") {
      throw new Error("Package artifact mismatch");
    }
    return artifact;
  }
  if (taskId === "config") {
    if (
      artifact.task !== "config"
      || artifact.maxConcurrentWorkers !== CONFIG.budgets.maxConcurrentWorkers
      || artifact.discoverOllama !== CONFIG.candidates.ollama.discover
      || artifact.configuredCodexCandidates !== CONFIG.candidates.openai.length
    ) {
      throw new Error("Config artifact mismatch");
    }
    return artifact;
  }
  throw new Error(`Unknown smoke task: ${taskId}`);
}

export function buildSmokeInvocation({ provider, model, reasoningEffort, outputPath }) {
  if (!["ollama", "openai"].includes(provider)) throw new Error(`Unsupported provider: ${provider}`);
  const command = process.platform === "win32" ? "codex.exe" : "codex";
  const args = ["exec"];
  if (provider === "ollama") args.push("--oss", "--local-provider", "ollama");
  args.push(
    "-m", model,
    "-c", `model_reasoning_effort="${reasoningEffort}"`,
    "--ephemeral",
    "--json",
    "--sandbox", "read-only",
    "-C", ROOT,
    "--output-last-message", outputPath,
    "-",
  );
  return { command, args };
}

function parseArgs(argv) {
  const options = { execute: false, provider: "ollama", model: null, reasoningEffort: "low", timeoutMinutes: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--execute") {
      options.execute = true;
      continue;
    }
    if (!["--provider", "--model", "--reasoning-effort", "--timeout-minutes"].includes(token)) throw new Error(`Unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    if (token === "--provider") options.provider = value;
    if (token === "--model") options.model = value;
    if (token === "--reasoning-effort") options.reasoningEffort = value;
    if (token === "--timeout-minutes") options.timeoutMinutes = Number(value);
    index += 1;
  }
  if (!Number.isInteger(options.timeoutMinutes) || options.timeoutMinutes < 1 || options.timeoutMinutes > 30) {
    throw new Error("Timeout must be an integer from 1 to 30 minutes");
  }
  if (!["ollama", "openai"].includes(options.provider)) throw new Error("Provider must be ollama or openai");
  if (!["low", "medium", "high"].includes(options.reasoningEffort)) throw new Error("Unsupported reasoning effort");
  if (!options.model) {
    if (options.provider === "openai") throw new Error("OpenAI smoke tests require an explicit --model");
    options.model = "qwen2.5:7b";
  }
  return options;
}

function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
  }
}

async function runWorker({ task, provider, model, reasoningEffort, runPath, timeoutMs, activeChildren }) {
  const workerPath = path.join(runPath, task.id);
  mkdirSync(workerPath, { recursive: true });
  const eventsPath = path.join(workerPath, "events.jsonl");
  const stderrPath = path.join(workerPath, "stderr.log");
  const outputPath = path.join(workerPath, "last-message.txt");
  writeFileSync(eventsPath, "");
  writeFileSync(stderrPath, "");
  writeFileSync(path.join(workerPath, "request.json"), `${JSON.stringify({
    taskId: task.id,
    provider,
    model,
    reasoningEffort,
    sandbox: "read-only",
    prompt: task.prompt,
  }, null, 2)}\n`);

  const { command, args } = buildSmokeInvocation({ provider, model, reasoningEffort, outputPath });
  const startedAtMs = Date.now();
  const child = spawn(command, args, {
    cwd: ROOT,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  activeChildren.add(child);
  child.stdout.on("data", (chunk) => appendFileSync(eventsPath, chunk));
  child.stderr.on("data", (chunk) => appendFileSync(stderrPath, chunk));
  child.stdin.on("error", () => {});
  child.stdin.end(task.prompt);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    terminateProcessTree(child);
  }, timeoutMs);
  let exitCode = null;
  let error = null;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } catch (caught) {
    error = caught.message;
  } finally {
    clearTimeout(timer);
    activeChildren.delete(child);
  }
  const finishedAtMs = Date.now();
  const finalMessage = existsSync(outputPath) ? readFileSync(outputPath, "utf8").trim() : "";
  let usage = null;
  try { usage = summarizeUsage(readFileSync(eventsPath, "utf8")); } catch {}
  let artifact = null;
  try {
    artifact = validateSmokeArtifact(task.id, finalMessage);
  } catch (caught) {
    error ??= caught.message;
  }
  const result = {
    taskId: task.id,
    pid: child.pid ?? null,
    provider,
    model,
    startedAtMs,
    finishedAtMs,
    elapsedMs: finishedAtMs - startedAtMs,
    exitCode,
    timedOut,
    usage,
    artifact,
    error,
    passed: exitCode === 0 && !timedOut && !error && artifact !== null,
  };
  writeFileSync(path.join(workerPath, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const preview = {
    experiment: "two-read-only-workers",
    provider: options.provider,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    workerCount: TASKS.length,
    timeoutMinutes: options.timeoutMinutes,
    execute: options.execute,
    tasks: TASKS.map(({ id }) => id),
  };
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return preview;
  }

  const stateRoot = path.join(ROOT, ".codex-factory", "fleet-smoke");
  mkdirSync(stateRoot, { recursive: true });
  const lockPath = path.join(stateRoot, "fleet-smoke.lock");
  let lockDescriptor;
  try {
    lockDescriptor = openSync(lockPath, "wx");
    writeFileSync(lockDescriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Another fleet smoke test owns the lock");
    throw error;
  } finally {
    if (lockDescriptor !== undefined) closeSync(lockDescriptor);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runPath = path.join(stateRoot, "runs", runId);
  mkdirSync(runPath, { recursive: true });
  const activeChildren = new Set();
  const stopAll = () => {
    for (const child of activeChildren) terminateProcessTree(child);
  };
  process.once("SIGINT", stopAll);
  process.once("SIGTERM", stopAll);
  try {
    const wallStartedAtMs = Date.now();
    const results = await Promise.all(TASKS.map((task) => runWorker({
      task,
      provider: options.provider,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      runPath,
      timeoutMs: options.timeoutMinutes * 60_000,
      activeChildren,
    })));
    const wallFinishedAtMs = Date.now();
    const overlap = workersOverlap(results);
    const summary = {
      ...preview,
      execute: true,
      runId,
      runPath,
      wallElapsedMs: wallFinishedAtMs - wallStartedAtMs,
      workerElapsedTotalMs: results.reduce((total, result) => total + result.elapsedMs, 0),
      overlap,
      allPassed: overlap && results.every((result) => result.passed),
      results,
    };
    writeFileSync(path.join(runPath, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.allPassed) process.exitCode = 1;
    return summary;
  } finally {
    process.removeListener("SIGINT", stopAll);
    process.removeListener("SIGTERM", stopAll);
    stopAll();
    rmSync(lockPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
