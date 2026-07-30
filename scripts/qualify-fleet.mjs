#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  discoverCandidatePool,
  discoverOllama,
  ollamaBaseUrl,
  codexLauncher,
  qualificationPlan,
} from "./factory-fleet.mjs";
import { reconcilePaidUsage, reservePaidUsage } from "./factory-admission.mjs";
import { superviseProcess } from "./factory-process.mjs";
import { acquireWorkerSlot } from "./factory-slots.mjs";
import { parseCliArgs, printHelp, reportCliError } from "./factory-cli.mjs";
import { summarizeUsage } from "./run-worker.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANALYSIS_MARKER = "CODEX_FACTORY_ANALYSIS_QUALIFIED";
const WRITE_PATH = "src/value.mjs";
const WRITE_CONTENT = "export const value = 42;\n";
const USAGE = `Usage:
  node scripts/qualify-fleet.mjs [--provider <provider>] [--model <model>]
    [--role <role>] [--include-paid] [--execute]

Options:
  --provider <provider>  Filter qualifications by provider.
  --model <model>        Filter qualifications by exact model.
  --role <role>          Filter qualifications by role.
  --include-paid         DANGEROUS: admit configured paid candidates to the plan.
  --execute              DANGEROUS: run qualifications; otherwise dry-run.
  -h, --help             Show this help.`;

export function parseQualificationArgs(argv) {
  return parseCliArgs(argv, {
    valueFlags: { "--provider": "provider", "--model": "model", "--role": "role" },
    booleanFlags: { "--execute": "execute", "--include-paid": "includePaid" },
    defaults: { execute: false, includePaid: false, provider: null, model: null, role: null },
  });
}

export function filterQualificationPlan(plan, options) {
  return plan.filter((item) =>
    (options.includePaid || item.provider !== "openai")
    && (!options.provider || item.provider === options.provider)
    && (!options.model || item.model === options.model)
    && (!options.role || item.role === options.role));
}

export function evaluateLocalQualification(role, payload) {
  if (role === "analysis") {
    return payload?.response?.trim() === ANALYSIS_MARKER
      ? { passed: true, detail: "exact analysis artifact returned" }
      : { passed: false, detail: "analysis artifact did not match exactly" };
  }
  if (role === "benchmark") {
    try {
      const artifact = JSON.parse(payload?.response);
      const exactKeys = artifact && typeof artifact === "object" && !Array.isArray(artifact)
        && Object.keys(artifact).sort().join(",") === "holeCount,reason,valid";
      const reason = typeof artifact?.reason === "string"
        ? artifact.reason.trim().toLowerCase().replace(/\s+/g, " ")
        : "";
      const passed = exactKeys
        && artifact.valid === false
        && /^60(?:\s*mm)?\s+exceeds\s+40(?:\s*mm)?[.!]?$/.test(reason)
        && artifact.holeCount === 4;
      return passed
        ? { passed: true, detail: "structured reasoning benchmark passed" }
        : { passed: false, detail: "structured reasoning benchmark was incorrect" };
    } catch {
      return { passed: false, detail: "structured reasoning benchmark was not valid JSON" };
    }
  }
  if (role === "structured_write") {
    try {
      const artifact = JSON.parse(payload?.response);
      const exact = artifact
        && Array.isArray(artifact.files)
        && artifact.files.length === 1
        && artifact.files[0]?.path === WRITE_PATH
        && artifact.files[0]?.content === WRITE_CONTENT
        && typeof artifact.summary === "string"
        && artifact.summary.trim();
      return exact
        ? { passed: true, detail: "exact structured-write artifact returned" }
        : { passed: false, detail: "structured-write artifact was incorrect" };
    } catch {
      return { passed: false, detail: "structured-write artifact was not valid JSON" };
    }
  }
  throw new Error(`Unsupported local qualification role: ${role}`);
}

function localRequest(item) {
  if (item.role === "analysis") {
    return {
      model: item.model,
      prompt: `Reply with exactly ${ANALYSIS_MARKER} and no other text. Do not use tools.`,
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: 64 },
    };
  }
  if (item.role === "benchmark") {
    return {
      model: item.model,
      prompt: [
        "A proposed design has two legs and requires two M4 holes per leg.",
        "The complete design must fit inside a 40 mm bounding box, but the proposed legs are 60 mm long.",
        "Reply with only one JSON object having exactly these keys and types:",
        "valid: boolean indicating whether every stated constraint can be satisfied;",
        "reason: string formatted as '<larger dimension> exceeds <bounding dimension>';",
        "holeCount: integer giving the total number of required holes across all legs.",
        "Derive every value. Do not use tools.",
      ].join(" "),
      stream: false,
      think: false,
      format: "json",
      options: { temperature: 0, num_predict: 128 },
    };
  }
  return {
    model: item.model,
    prompt: `Return one JSON object matching the schema. Create exactly ${WRITE_PATH} with complete content exactly ${JSON.stringify(WRITE_CONTENT)}. Include a non-empty summary. Return no Markdown or commentary.`,
    stream: false,
    think: false,
    format: {
      type: "object",
      properties: {
        files: {
          type: "array",
          minItems: 1,
          maxItems: 1,
          items: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
        summary: { type: "string" },
      },
      required: ["files", "summary"],
      additionalProperties: false,
    },
    options: { temperature: 0, num_predict: 1024 },
  };
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function qualifyLocal(item, timeoutMs) {
  const startedAtMs = Date.now();
  try {
    const response = await fetchWithTimeout(`${ollamaBaseUrl()}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(localRequest(item)),
    }, timeoutMs);
    const payload = await response.json();
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const evaluated = evaluateLocalQualification(item.role, payload);
    return {
      ...evaluated,
      durationMs: Date.now() - startedAtMs,
      usage: {
        input_tokens: Number.isSafeInteger(payload.prompt_eval_count) ? payload.prompt_eval_count : null,
        output_tokens: Number.isSafeInteger(payload.eval_count) ? payload.eval_count : null,
        total_tokens: Number.isSafeInteger(payload.prompt_eval_count) && Number.isSafeInteger(payload.eval_count)
          ? payload.prompt_eval_count + payload.eval_count
          : null,
      },
    };
  } catch (error) {
    return { passed: false, detail: error.message, durationMs: Date.now() - startedAtMs, usage: null };
  }
}

function initializeWriteFixture(root) {
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "README.md"), "Qualification fixture.\n");
  spawnSync("git", ["init", "-q"], { cwd: root, windowsHide: true });
  spawnSync("git", ["config", "user.email", "factory@example.invalid"], { cwd: root, windowsHide: true });
  spawnSync("git", ["config", "user.name", "Codex Factory"], { cwd: root, windowsHide: true });
  spawnSync("git", ["add", "."], { cwd: root, windowsHide: true });
  spawnSync("git", ["commit", "-qm", "fixture"], { cwd: root, windowsHide: true });
}

async function qualifyCodex(item, timeoutMs, receiptPath) {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "codex-factory-qualification-"));
  const outputPath = path.join(fixture, "last-message.txt");
  if (item.role === "workspace_write") initializeWriteFixture(fixture);
  const prompt = item.role === "analysis"
    ? `Reply with exactly ${ANALYSIS_MARKER} and no other text. Do not call tools.`
    : item.role === "benchmark"
      ? localRequest(item).prompt
      : `Create ${WRITE_PATH} with complete content exactly ${JSON.stringify(WRITE_CONTENT)}. Do not change any other file.`;
  const { command, argsPrefix } = codexLauncher();
  const args = [
    ...argsPrefix,
    "exec",
    "-m", item.model,
    "-c", `model_reasoning_effort="${item.reasoningEffort}"`,
    "--ephemeral",
    "--json",
    "--sandbox", item.role === "workspace_write" ? "workspace-write" : "read-only",
    "-C", fixture,
    "--output-last-message", outputPath,
    "-",
  ];
  const startedAt = new Date();
  const startedAtMs = startedAt.getTime();
  const stdout = [];
  const stderr = [];
  mkdirSync(receiptPath, { recursive: true });
  writeFileSync(path.join(receiptPath, "request.json"), `${JSON.stringify({
    provider: item.provider, model: item.model, role: item.role,
    reasoningEffort: item.reasoningEffort, prompt, args,
  }, null, 2)}\n`);
  const eventsPath = path.join(receiptPath, "events.jsonl");
  const stderrPath = path.join(receiptPath, "stderr.log");
  writeFileSync(eventsPath, "");
  writeFileSync(stderrPath, "");
  let processResult = { exitCode: null, timedOut: false, interrupted: null };
  let processError = null;
  try {
    processResult = await superviseProcess({
      command,
      args,
      cwd: fixture,
      prompt,
      timeoutMs,
      onStdout: (chunk) => {
        stdout.push(chunk);
        appendFileSync(eventsPath, chunk);
      },
      onStderr: (chunk) => {
        stderr.push(chunk);
        appendFileSync(stderrPath, chunk);
      },
    });
  } catch (error) {
    processError = error.message;
    if (error.code === "PROCESS_NOT_REAPED") throw error;
  }
  const events = Buffer.concat(stdout).toString("utf8");
  const usage = summarizeUsage(events);
  const finalMessage = existsSync(outputPath) ? readFileSync(outputPath, "utf8").trim() : "";
  const artifactPassed = item.role === "workspace_write"
    ? existsSync(path.join(fixture, WRITE_PATH)) && readFileSync(path.join(fixture, WRITE_PATH), "utf8") === WRITE_CONTENT
    : evaluateLocalQualification(item.role, { response: finalMessage }).passed;
  const passed = processResult.exitCode === 0 && !processResult.timedOut && !processResult.interrupted
    && !processError && artifactPassed && usage !== null;
  const result = {
    passed,
    detail: passed
      ? `exact ${item.role.replace("_", "-")} artifact returned`
      : processError ?? (processResult.timedOut ? "qualification timed out" : Buffer.concat(stderr).toString("utf8").trim() || "qualification artifact was incorrect"),
    durationMs: Date.now() - startedAtMs,
    usage,
    exitCode: processResult.exitCode,
    timedOut: processResult.timedOut,
    interrupted: processResult.interrupted,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(receiptPath, "last-message.txt"), `${finalMessage}\n`);
  writeFileSync(path.join(receiptPath, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  rmSync(fixture, { recursive: true, force: true });
  return result;
}

function readJsonLines(filename) {
  if (!existsSync(filename)) return [];
  return readFileSync(filename, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseQualificationArgs(argv);
  if (options.help) {
    printHelp(USAGE);
    return null;
  }
  const config = JSON.parse(readFileSync(path.join(ROOT, "factory.config.json"), "utf8"));
  const ollama = await discoverOllama();
  const candidates = discoverCandidatePool({ config, ollama });
  const completePlan = qualificationPlan(candidates).map((item) => ({
    ...item,
    ...candidates.find((candidate) => candidate.id === item.candidateId),
  }));
  const plan = filterQualificationPlan(completePlan, options);
  const preview = {
    execute: options.execute,
    includePaid: options.includePaid,
    discoveredCandidates: candidates.map(({ id, provider, model, tier, runtimeVersion, digest }) => ({ id, provider, model, tier, runtimeVersion, digest })),
    qualificationCount: plan.length,
    qualifications: plan.map(({ candidateId, provider, model, role, harness, fingerprint, digest }) => ({ candidateId, provider, model, role, harness, fingerprint, digest })),
    deferredPaidQualifications: completePlan.filter((item) => item.provider === "openai" && !options.includePaid).length,
  };
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return preview;
  }

  const stateRoot = path.join(ROOT, ".codex-factory");
  mkdirSync(stateRoot, { recursive: true });
  const qualificationLedgerPath = path.join(stateRoot, "qualifications.jsonl");
  const results = [];
  for (const item of plan) {
    let reservation = null;
    let slot = null;
    let invocationId = null;
    let preserveSlot = false;
    const taskId = `qualify-${item.model}-${item.role}`;
    if (item.paid) {
      reservation = item.tokenReservation;
      if (!Number.isSafeInteger(reservation) || reservation <= 0) throw new Error(`Paid candidate ${item.model} needs a token reservation`);
      slot = acquireWorkerSlot(stateRoot, config.budgets.maxConcurrentWorkers, {
        taskId, provider: item.provider, model: item.model,
      });
      try {
        const admission = await reservePaidUsage({
          stateRoot,
          aggregateLimit: config.budgets.aggregatePaidTokens,
          reservedTokens: reservation,
          taskId,
          metadata: { provider: item.provider, model: item.model, role: item.role },
        });
        invocationId = admission.invocationId;
      } catch (error) {
        slot.release();
        throw error;
      }
    }
    let result;
    const receiptPath = item.paid
      ? path.join(stateRoot, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${invocationId}`)
      : null;
    try {
      result = item.provider === "ollama"
        ? await qualifyLocal(item, config.budgets.qualificationMinutes * 60_000)
        : await qualifyCodex(
          item,
          config.budgets.qualificationMinutes * 60_000,
          receiptPath,
        );
    } catch (error) {
      if (error.code === "PROCESS_NOT_REAPED" && slot) {
        preserveSlot = true;
        slot.quarantine({ taskId, invocationId, childPid: error.childPid, processGroup: error.processGroup, reason: "qualification-not-reaped" });
      }
      result = { passed: false, detail: error.message, durationMs: 0, usage: null };
      if (receiptPath) {
        mkdirSync(receiptPath, { recursive: true });
        writeFileSync(path.join(receiptPath, "result.json"), `${JSON.stringify({
          ...result,
          invocationId,
          taskId,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        }, null, 2)}\n`);
      }
    }
    if (item.paid && result.usage?.total_tokens > reservation) {
      result.passed = false;
      result.detail = `qualification used ${result.usage.total_tokens} tokens against ${reservation} reserved`;
    }
    const record = {
      candidateId: item.candidateId,
      provider: item.provider,
      model: item.model,
      role: item.role,
      harness: item.harness,
      fingerprint: item.fingerprint,
      digest: item.digest ?? null,
      passed: result.passed,
      detail: result.detail,
      durationMs: result.durationMs,
      usage: result.usage,
      invocationId,
      finishedAt: new Date().toISOString(),
    };
    appendFileSync(qualificationLedgerPath, `${JSON.stringify(record)}\n`);
    if (item.paid) {
      try {
        await reconcilePaidUsage({
          stateRoot, invocationId, taskId, usage: result.usage,
          metadata: { provider: item.provider, model: item.model, role: item.role, status: result.passed ? "process_completed" : "failed" },
        });
      } finally {
        if (!preserveSlot) slot.release();
      }
    }
    results.push(record);
  }
  const summary = {
    ...preview,
    execute: true,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    results,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.failed) process.exitCode = 1;
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(reportCliError);
}
