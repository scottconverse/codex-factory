#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reconcilePaidUsage, reservePaidUsage } from "./factory-admission.mjs";
import { superviseProcess } from "./factory-process.mjs";
import { codexLauncher } from "./factory-fleet.mjs";
import { acquireFileLock, acquireWorkerSlot } from "./factory-slots.mjs";
import { summarizeUsage } from "./run-worker.mjs";
import { parseCliArgs, printHelp, reportCliError } from "./factory-cli.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = `Usage:
  node scripts/fleet-smoke.mjs [--provider <ollama|openai>] [--model <model>]
    [--reasoning-effort <low|medium|high>] [--timeout-minutes <minutes>] [--execute]

Options:
  --provider <provider>          Select ollama (default) or openai.
  --model <model>                Select the exact model; required for openai.
  --reasoning-effort <effort>   Select low (default), medium, or high.
  --timeout-minutes <minutes>   Bound each worker to 1-30 minutes.
  --execute                     DANGEROUS: launch two workers; otherwise dry-run.
  -h, --help                    Show this help.`;
const PACKAGE_SOURCE = readFileSync(path.join(ROOT, "package.json"), "utf8");
const PACKAGE = JSON.parse(PACKAGE_SOURCE);
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
    if (artifact.task !== "package" || artifact.name !== PACKAGE.name || artifact.version !== PACKAGE.version) {
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
  const { command, argsPrefix } = codexLauncher();
  const args = [...argsPrefix, "exec"];
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
  const options = parseCliArgs(argv, {
    valueFlags: {
      "--provider": "provider",
      "--model": "model",
      "--reasoning-effort": "reasoningEffort",
      "--timeout-minutes": "timeoutMinutes",
    },
    booleanFlags: { "--execute": "execute" },
    defaults: { execute: false, provider: "ollama", model: null, reasoningEffort: "low", timeoutMinutes: 3 },
  });
  if (options.help) return options;
  options.timeoutMinutes = Number(options.timeoutMinutes);
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

async function runWorker({
  task, provider, model, reasoningEffort, runPath, timeoutMs, stateRoot,
  tokenReservation, aggregateLimit, maxConcurrentWorkers,
}) {
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

  const taskId = `fleet-smoke-${task.id}`;
  const slot = acquireWorkerSlot(stateRoot, maxConcurrentWorkers, { taskId, provider, model });
  let preserveSlot = false;
  let invocationId = null;
  if (provider === "openai") {
    try {
      const admission = await reservePaidUsage({
        stateRoot, aggregateLimit, reservedTokens: tokenReservation, taskId,
        metadata: { provider, model, role: "fleet-smoke" },
      });
      invocationId = admission.invocationId;
    } catch (error) {
      slot.release();
      throw error;
    }
  }
  const { command, args } = buildSmokeInvocation({ provider, model, reasoningEffort, outputPath });
  const startedAtMs = Date.now();
  let processResult = { exitCode: null, timedOut: false, interrupted: null, pid: null };
  let error = null;
  try {
    processResult = await superviseProcess({
      command, args, cwd: ROOT, prompt: task.prompt, timeoutMs,
      onStdout: (chunk) => appendFileSync(eventsPath, chunk),
      onStderr: (chunk) => appendFileSync(stderrPath, chunk),
    });
  } catch (caught) {
    error = caught.message;
    if (caught.code === "PROCESS_NOT_REAPED") {
      preserveSlot = true;
      slot.quarantine({ taskId, invocationId, childPid: caught.childPid, processGroup: caught.processGroup, reason: "fleet-smoke-not-reaped" });
    }
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
    invocationId,
    pid: processResult.pid,
    provider,
    model,
    startedAtMs,
    finishedAtMs,
    elapsedMs: finishedAtMs - startedAtMs,
    exitCode: processResult.exitCode,
    timedOut: processResult.timedOut,
    interrupted: processResult.interrupted,
    usage,
    artifact,
    error,
    passed: processResult.exitCode === 0 && !processResult.timedOut && !processResult.interrupted
      && !error && artifact !== null
      && (provider !== "openai" || (usage !== null && usage.total_tokens <= tokenReservation)),
  };
  if (provider === "openai" && usage?.total_tokens > tokenReservation) {
    result.error = `fleet smoke used ${usage.total_tokens} tokens against ${tokenReservation} reserved`;
  }
  writeFileSync(path.join(workerPath, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  try {
    if (provider === "openai") {
      await reconcilePaidUsage({
        stateRoot, invocationId, taskId, usage,
        metadata: { provider, model, role: "fleet-smoke", status: result.passed ? "process_completed" : "failed" },
      });
    }
  } finally {
    if (!preserveSlot) slot.release();
  }
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp(USAGE);
    return null;
  }
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

  const stateRoot = path.join(ROOT, ".codex-factory");
  mkdirSync(stateRoot, { recursive: true });
  const smokeStateRoot = path.join(stateRoot, "fleet-smoke");
  mkdirSync(smokeStateRoot, { recursive: true });
  const smokeLock = await acquireFileLock(path.join(smokeStateRoot, "fleet-smoke.lock"), { provider: options.provider }, { timeoutMs: 1 });
  const paidCandidate = options.provider === "openai"
    ? CONFIG.candidates?.openai?.find((candidate) => candidate.model === options.model)
    : null;
  if (options.provider === "openai" && !paidCandidate) {
    smokeLock.release();
    throw new Error(`OpenAI smoke model ${options.model} is not a configured paid candidate`);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runPath = path.join(smokeStateRoot, "runs", runId);
  mkdirSync(runPath, { recursive: true });
  try {
    const wallStartedAtMs = Date.now();
    const settled = await Promise.allSettled(TASKS.map((task) => runWorker({
      task,
      provider: options.provider,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      runPath,
      timeoutMs: options.timeoutMinutes * 60_000,
      stateRoot,
      tokenReservation: paidCandidate?.tokenReservation ?? null,
      aggregateLimit: CONFIG.budgets.aggregatePaidTokens,
      maxConcurrentWorkers: CONFIG.budgets.maxConcurrentWorkers,
    })));
    const rejected = settled.find((item) => item.status === "rejected");
    if (rejected) throw rejected.reason;
    const results = settled.map((item) => item.value);
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
    smokeLock.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(reportCliError);
}
