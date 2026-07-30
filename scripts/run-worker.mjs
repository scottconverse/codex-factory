#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverCandidatePool, discoverOllama, selectCandidate } from "./factory-fleet.mjs";
import { acquireWorkerSlot } from "./factory-slots.mjs";
import {
  reconcilePaidUsage,
  reservePaidUsage,
  summarizeLedger,
  usageSpent,
} from "./factory-admission.mjs";
import { superviseProcess } from "./factory-process.mjs";
import { parseCliArgs, printHelp, reportCliError } from "./factory-cli.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = `Usage:
  node scripts/run-worker.mjs --task-id <id> --role <role> --cwd <directory>
    --prompt-file <file> [--candidate-id <id>] [--timeout-minutes <minutes>]
    [--config <file>] [--execute]

Options:
  --task-id <id>              Required single-use task identifier.
  --role <role>               Required configured worker role.
  --cwd <directory>           Required target Git worktree.
  --prompt-file <file>        Required bounded worker prompt.
  --candidate-id <id>         Pin an exactly qualified candidate.
  --timeout-minutes <minutes> Bound worker wall-clock time.
  --config <file>             Use an alternate factory configuration.
  --execute                   DANGEROUS: launch the selected worker; otherwise dry-run.
  -h, --help                  Show this help.`;

export function parseArgs(argv) {
  return parseCliArgs(argv, {
    valueFlags: {
      "--task-id": "taskId",
      "--role": "role",
      "--cwd": "cwd",
      "--prompt-file": "promptFile",
      "--candidate-id": "candidateId",
      "--timeout-minutes": "timeoutMinutes",
      "--config": "config",
    },
    booleanFlags: { "--execute": "execute" },
    defaults: { execute: false },
  });
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

export { summarizeLedger };

export function classifyResult({ processResult, executionError, usage, finalMessage, tokenReservation }) {
  if (processResult.timedOut) return "timed_out";
  if (executionError || processResult.interrupted || processResult.exitCode !== 0 || !usage || !finalMessage.trim()) return "failed";
  if (usage.total_tokens > tokenReservation) return "over_budget";
  return "process_completed";
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

async function executeWorker({ invocation, prompt, timeoutMs, eventsPath, stderrPath }) {
  return superviseProcess({
    command: invocation.command,
    args: invocation.args,
    cwd: ROOT,
    prompt,
    timeoutMs,
    onStdout: (chunk) => appendFileSync(eventsPath, chunk),
    onStderr: (chunk) => appendFileSync(stderrPath, chunk),
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp(USAGE);
    return null;
  }
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
    let lockedSpent;
    let lockedRemaining;
    let runId;
    let runPath;
    let outputPath;
    let eventsPath;
    let stderrPath;
    let exactInvocation;
    let startedAt;
    let invocationId = null;
    if (route.paid) {
      const admission = await reservePaidUsage({
        stateRoot,
        aggregateLimit,
        reservedTokens: route.tokenReservation,
        taskId: options.taskId,
        rejectTaskReuse: true,
        metadata: { role: options.role, provider: route.provider, model: route.model },
      });
      ({ invocationId, spent: lockedSpent, remaining: lockedRemaining } = admission);
    } else {
      if (taskWasAttempted(ledgerPath, options.taskId)) throw new Error(`Task ${options.taskId} already has an attempt`);
      lockedSpent = null;
      lockedRemaining = null;
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
      if (!route.paid) appendFileSync(ledgerPath, `${JSON.stringify({
        stage: "reserved", invocationId: runId, runId, taskId: options.taskId, role: options.role,
        provider: route.provider, model: route.model, paid: false, reservedTokens: null,
        startedAt: startedAt.toISOString(),
      })}\n`);

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
      if (error.code === "PROCESS_NOT_REAPED") {
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
      invocationId: invocationId ?? runId,
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
    if (route.paid) {
      await reconcilePaidUsage({
        stateRoot, invocationId, taskId: options.taskId, usage,
        metadata: { ...result, invocationId, stage: "terminal" },
      });
    } else appendFileSync(ledgerPath, `${JSON.stringify(result)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (status !== "process_completed") process.exitCode = 1;
    return result;
  } finally {
    if (!preserveLock) slot.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(reportCliError);
}
