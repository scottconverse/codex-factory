#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverCandidatePool, discoverOllama, selectCandidate } from "./factory-fleet.mjs";
import { acquireFileLock, acquireWorkerSlot } from "./factory-slots.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const parsed = { execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--execute") {
      parsed.execute = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

export function validateConfig(config) {
  if (config?.version !== 1) throw new Error("factory.config.json version must be 1");
  for (const key of ["aggregatePaidTokens", "maxWorkerMinutes", "maxAttemptsPerTask", "maxConcurrentWorkers"]) {
    if (!Number.isSafeInteger(config.budgets?.[key]) || config.budgets[key] <= 0) throw new Error(`Invalid budget: ${key}`);
  }
  if ("qualificationMinutes" in config.budgets && (!Number.isSafeInteger(config.budgets.qualificationMinutes) || config.budgets.qualificationMinutes <= 0)) {
    throw new Error("Invalid budget: qualificationMinutes");
  }
  if (config.budgets.maxAttemptsPerTask !== 1) throw new Error("Initial factory permits exactly one attempt per task");
  if (config.budgets.maxConcurrentWorkers < 1 || config.budgets.maxConcurrentWorkers > 4) {
    throw new Error("maxConcurrentWorkers must be between 1 and 4");
  }
  for (const [name, route] of Object.entries(config.routes ?? {})) {
    if (!route.provider) {
      if (!["analysis", "structured_write", "workspace_write"].includes(route.qualificationRole)) {
        throw new Error(`Route ${name} has an unsupported qualification role`);
      }
      if (!["economy", "standard", "premium"].includes(route.requiredTier)) {
        throw new Error(`Route ${name} has an unsupported required tier`);
      }
      if (!["read-only", "workspace-write"].includes(route.sandbox)) throw new Error(`Route ${name} has an unsupported sandbox`);
      continue;
    }
    if (!["openai", "ollama"].includes(route.provider)) throw new Error(`Route ${name} has an unsupported provider`);
    if (!route.model) throw new Error(`Route ${name} is incomplete`);
    if (!["low", "medium", "high", "xhigh"].includes(route.reasoningEffort)) throw new Error(`Route ${name} has an unsupported reasoning effort`);
    if (!["read-only", "workspace-write"].includes(route.sandbox)) throw new Error(`Route ${name} has an unsupported sandbox`);
    if (typeof route.paid !== "boolean") throw new Error(`Route ${name} must declare whether it is paid`);
    if ((route.provider === "openai") !== route.paid) throw new Error(`Route ${name} provider and paid flag disagree`);
    if (route.paid && (!Number.isSafeInteger(route.tokenReservation) || route.tokenReservation <= 0)) {
      throw new Error(`Route ${name} needs a positive token reservation`);
    }
    if (!route.paid && "tokenReservation" in route) {
      throw new Error(`Local route ${name} must not declare a token reservation`);
    }
  }
  for (const candidate of config.candidates?.openai ?? []) {
    if (typeof candidate.model !== "string" || !candidate.model) throw new Error("Configured Codex candidate requires a model");
    if (!["economy", "standard", "premium"].includes(candidate.tier)) throw new Error(`Unsupported candidate tier: ${candidate.tier}`);
    if (!["low", "medium", "high", "xhigh"].includes(candidate.reasoningEffort)) throw new Error(`Unsupported reasoning effort for ${candidate.model}`);
    if (!Number.isSafeInteger(candidate.tokenReservation) || candidate.tokenReservation <= 0) throw new Error(`Paid candidate ${candidate.model} needs a token reservation`);
  }
  return config;
}

export function resolveRouteCandidate({ config, role, candidates, qualifications, candidateId = null }) {
  const requirement = config.routes?.[role];
  if (!requirement) throw new Error(`Unknown role: ${role}`);
  const available = candidateId ? candidates.filter((candidate) => candidate.id === candidateId) : candidates;
  if (candidateId && !available.length) throw new Error(`Unknown candidate: ${candidateId}`);
  const selected = selectCandidate({
    candidates: available,
    qualifications,
    role: requirement.qualificationRole,
    requiredTier: requirement.requiredTier,
  });
  return { ...selected, sandbox: requirement.sandbox };
}

export function buildInvocation({ route, cwd, outputPath }) {
  const command = process.platform === "win32" ? "codex.exe" : "codex";
  const args = ["exec"];
  if (route.provider === "ollama") args.push("--oss", "--local-provider", "ollama");
  args.push(
    "-m", route.model,
    "-c", `model_reasoning_effort="${route.reasoningEffort}"`,
    "--ephemeral",
    "--json",
    "--sandbox", route.sandbox,
    "-C", cwd,
    "--output-last-message", outputPath,
    "-",
  );
  return { command, args };
}

export function summarizeUsage(eventsText) {
  let usage = null;
  for (const line of eventsText.split(/\r?\n/).filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type === "turn.completed" && event.usage) usage = event.usage;
  }
  if (!usage) return null;
  const inputTokens = Number(usage.input_tokens);
  const outputTokens = Number(usage.output_tokens);
  if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) return null;
  return { ...usage, total_tokens: inputTokens + outputTokens };
}

export function summarizeLedger(ledgerText, paid) {
  const latestByTask = new Map();
  for (const line of ledgerText.split(/\r?\n/).filter(Boolean)) {
    const entry = JSON.parse(line);
    if (entry.paid === paid) latestByTask.set(entry.taskId, entry);
  }
  return [...latestByTask.values()].reduce((total, entry) => {
    if (entry.stage === "reserved") {
      if (!Number.isSafeInteger(entry.reservedTokens)) throw new Error("Usage ledger contains an invalid reservation");
      return total + entry.reservedTokens;
    }
    if (!Number.isSafeInteger(entry.usage?.total_tokens)) {
      if (paid) throw new Error("Paid usage ledger contains a run without trustworthy token usage");
      return total;
    }
    return total + entry.usage.total_tokens;
  }, 0);
}

export function classifyResult({ processResult, executionError, usage, finalMessage, tokenReservation }) {
  if (processResult.timedOut) return "timed_out";
  if (executionError || processResult.interrupted || processResult.exitCode !== 0 || !usage || !finalMessage.trim()) return "failed";
  if (usage.total_tokens > tokenReservation) return "over_budget";
  return "process_completed";
}

function usageSpent(ledgerPath, paid) {
  return existsSync(ledgerPath) ? summarizeLedger(readFileSync(ledgerPath, "utf8"), paid) : 0;
}

function readJsonLines(filename) {
  if (!existsSync(filename)) return [];
  return readFileSync(filename, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function taskWasAttempted(ledgerPath, taskId) {
  if (!existsSync(ledgerPath)) return false;
  return readFileSync(ledgerPath, "utf8").split(/\r?\n/).filter(Boolean)
    .some((line) => JSON.parse(line).taskId === taskId);
}

function assertGitRepository(cwd) {
  const check = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true });
  if (check.status !== 0) throw new Error(`Worker cwd must be a Git repository: ${cwd}`);
}

function terminateOwnedProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return true;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return result.status === 0 || child.exitCode !== null;
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
      return true;
    } catch {
      return child.exitCode !== null;
    }
  }
}

async function executeWorker({ invocation, prompt, timeoutMs, eventsPath, stderrPath }) {
  const child = spawn(invocation.command, invocation.args, {
    cwd: ROOT,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => appendFileSync(eventsPath, chunk));
  child.stderr.on("data", (chunk) => appendFileSync(stderrPath, chunk));
  let timedOut = false;
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
  let interrupted = null;
  let rejectUnreaped;
  const unreaped = new Promise((_, reject) => { rejectUnreaped = reject; });
  let reapDeadline = null;
  const requestTermination = (reason) => {
    if (reason !== "timeout") interrupted = reason;
    terminateOwnedProcessTree(child);
    if (!reapDeadline) {
      reapDeadline = setTimeout(() => {
        const error = new Error(`Worker process tree was not reaped after ${reason}`);
        error.code = "WORKER_NOT_REAPED";
        rejectUnreaped(error);
      }, 10_000);
    }
  };
  const onSigint = () => requestTermination("SIGINT");
  const onSigterm = () => requestTermination("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  const timer = setTimeout(() => {
    timedOut = true;
    requestTermination("timeout");
  }, timeoutMs);
  let exitCode;
  try {
    exitCode = await Promise.race([completion, unreaped]);
  } finally {
    clearTimeout(timer);
    if (reapDeadline) clearTimeout(reapDeadline);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
  return { exitCode, timedOut, interrupted };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  for (const required of ["taskId", "role", "cwd", "promptFile"]) {
    if (!options[required]) throw new Error(`Missing --${required.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(options.taskId)) throw new Error("Task ID must use lowercase letters, digits, underscores, or hyphens");
  const configPath = path.resolve(options.config ?? path.join(ROOT, "factory.config.json"));
  const config = validateConfig(JSON.parse(readFileSync(configPath, "utf8")));
  const ollama = await discoverOllama().catch(() => ({ runtimeVersion: "unavailable", models: [] }));
  const candidates = discoverCandidatePool({ config, ollama });
  const qualifications = readJsonLines(path.join(ROOT, ".codex-factory", "qualifications.jsonl"));
  const route = resolveRouteCandidate({
    config,
    role: options.role,
    candidates,
    qualifications,
    candidateId: options.candidateId ?? null,
  });
  const cwd = path.resolve(options.cwd);
  const promptPath = path.resolve(options.promptFile);
  assertGitRepository(cwd);
  const prompt = readFileSync(promptPath, "utf8");
  for (const marker of ["Acceptance criteria", "Allowed paths", "Required checks", "Do not delegate"]) {
    if (!prompt.includes(marker)) throw new Error(`Prompt is missing required marker: ${marker}`);
  }
  const timeoutMinutes = options.timeoutMinutes === undefined
    ? config.budgets.maxWorkerMinutes
    : Number(options.timeoutMinutes);
  if (!Number.isSafeInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > config.budgets.maxWorkerMinutes) {
    throw new Error(`--timeout-minutes must be between 1 and ${config.budgets.maxWorkerMinutes}`);
  }

  const stateRoot = path.join(ROOT, ".codex-factory");
  const ledgerPath = path.join(stateRoot, "usage.jsonl");
  const aggregateLimit = route.paid ? config.budgets.aggregatePaidTokens : null;
  const spent = route.paid ? usageSpent(ledgerPath, true) : null;
  const remaining = route.paid ? aggregateLimit - spent : null;
  if (route.paid && route.tokenReservation > remaining) throw new Error(`Route reservation ${route.tokenReservation} exceeds remaining budget ${remaining}`);
  const previewOutput = path.join(stateRoot, "dry-run-last-message.txt");
  const invocation = buildInvocation({ route, cwd, outputPath: previewOutput });
  const preview = {
    taskId: options.taskId,
    role: options.role,
    provider: route.provider,
    model: route.model,
    reasoningEffort: route.reasoningEffort,
    sandbox: route.sandbox,
    tokenReservation: route.paid ? route.tokenReservation : null,
    tokenAccounting: route.paid ? "admission-and-reconciliation" : "telemetry-only",
    spent,
    remaining,
    timeoutMinutes,
    command: invocation.command,
    args: invocation.args,
    execute: options.execute,
  };
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return preview;
  }

  mkdirSync(stateRoot, { recursive: true });
  const slot = acquireWorkerSlot(stateRoot, config.budgets.maxConcurrentWorkers, {
    taskId: options.taskId,
    provider: route.provider,
    model: route.model,
  });
  let preserveLock = false;
  try {
    let ledgerLock = await acquireFileLock(path.join(stateRoot, "usage.lock"), { taskId: options.taskId });
    let lockedSpent;
    let lockedRemaining;
    let runId;
    let runPath;
    let outputPath;
    let eventsPath;
    let stderrPath;
    let exactInvocation;
    let startedAt;
    try {
      if (taskWasAttempted(ledgerPath, options.taskId)) throw new Error(`Task ${options.taskId} already has an attempt`);
      lockedSpent = route.paid ? usageSpent(ledgerPath, true) : null;
      lockedRemaining = route.paid ? aggregateLimit - lockedSpent : null;
      if (route.paid && route.tokenReservation > lockedRemaining) {
        throw new Error(`Route reservation ${route.tokenReservation} exceeds remaining budget ${lockedRemaining}`);
      }
      const executionPreview = { ...preview, spent: lockedSpent, remaining: lockedRemaining };

      startedAt = new Date();
      runId = `${startedAt.toISOString().replace(/[:.]/g, "-")}-${options.taskId}`;
      runPath = path.join(stateRoot, "runs", runId);
      mkdirSync(runPath, { recursive: true });
      outputPath = path.join(runPath, "last-message.txt");
      eventsPath = path.join(runPath, "events.jsonl");
      stderrPath = path.join(runPath, "stderr.log");
      exactInvocation = buildInvocation({ route, cwd, outputPath });
      writeFileSync(path.join(runPath, "request.json"), `${JSON.stringify({ ...executionPreview, args: exactInvocation.args, promptPath, startedAt: startedAt.toISOString() }, null, 2)}\n`);
      writeFileSync(eventsPath, "");
      writeFileSync(stderrPath, "");
      appendFileSync(ledgerPath, `${JSON.stringify({
        stage: "reserved",
        runId,
        taskId: options.taskId,
        role: options.role,
        provider: route.provider,
        model: route.model,
        paid: route.paid,
        reservedTokens: route.paid ? route.tokenReservation : null,
        startedAt: startedAt.toISOString(),
      })}\n`);
    } finally {
      ledgerLock.release();
    }

    let processResult;
    let executionError = null;
    try {
      processResult = await executeWorker({
        invocation: exactInvocation,
        prompt,
        timeoutMs: timeoutMinutes * 60_000,
        eventsPath,
        stderrPath,
      });
    } catch (error) {
      executionError = error;
      processResult = { exitCode: null, timedOut: false, interrupted: null };
      if (error.code === "WORKER_NOT_REAPED") {
        preserveLock = true;
        slot.quarantine({ taskId: options.taskId, runId, reason: "worker-not-reaped" });
      }
      appendFileSync(stderrPath, `\nRunner error: ${error.message}\n`);
    }
    let usage = null;
    try { usage = summarizeUsage(readFileSync(eventsPath, "utf8")); } catch {}
    const finalMessage = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
    const status = classifyResult({
      processResult,
      executionError,
      usage,
      finalMessage,
      tokenReservation: route.paid ? route.tokenReservation : Number.MAX_SAFE_INTEGER,
    });
    const result = {
      runId,
      taskId: options.taskId,
      role: options.role,
      provider: route.provider,
      model: route.model,
      paid: route.paid,
      stage: "terminal",
      status,
      exitCode: processResult.exitCode,
      timedOut: processResult.timedOut,
      error: executionError?.message ?? null,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      usage,
      runPath,
    };
    writeFileSync(path.join(runPath, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    ledgerLock = await acquireFileLock(path.join(stateRoot, "usage.lock"), { taskId: options.taskId, stage: "terminal" });
    try {
      appendFileSync(ledgerPath, `${JSON.stringify(result)}\n`);
    } finally {
      ledgerLock.release();
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (status !== "process_completed") process.exitCode = 1;
    return result;
  } finally {
    if (!preserveLock) slot.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
