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
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  discoverCandidatePool,
  discoverOllama,
  qualificationPlan,
} from "./factory-fleet.mjs";
import { summarizeLedger, summarizeUsage } from "./run-worker.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANALYSIS_MARKER = "CODEX_FACTORY_ANALYSIS_QUALIFIED";
const WRITE_PATH = "src/value.mjs";
const WRITE_CONTENT = "export const value = 42;\n";

export function parseQualificationArgs(argv) {
  const options = { execute: false, includePaid: false, provider: null, model: null, role: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--execute") {
      options.execute = true;
      continue;
    }
    if (token === "--include-paid") {
      options.includePaid = true;
      continue;
    }
    if (!["--provider", "--model", "--role"].includes(token)) throw new Error(`Unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    options[token.slice(2)] = value;
    index += 1;
  }
  return options;
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
    const response = await fetchWithTimeout("http://127.0.0.1:11434/api/generate", {
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

function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
  }
}

async function qualifyCodex(item, timeoutMs) {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "codex-factory-qualification-"));
  const outputPath = path.join(fixture, "last-message.txt");
  if (item.role === "workspace_write") initializeWriteFixture(fixture);
  const prompt = item.role === "analysis"
    ? `Reply with exactly ${ANALYSIS_MARKER} and no other text. Do not call tools.`
    : item.role === "benchmark"
      ? localRequest(item).prompt
      : `Create ${WRITE_PATH} with complete content exactly ${JSON.stringify(WRITE_CONTENT)}. Do not change any other file.`;
  const args = [
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
  const startedAtMs = Date.now();
  const child = spawn(process.platform === "win32" ? "codex.exe" : "codex", args, {
    cwd: fixture,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    terminateProcessTree(child);
  }, timeoutMs);
  let exitCode = null;
  let processError = null;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } catch (error) {
    processError = error.message;
  } finally {
    clearTimeout(timer);
  }
  const events = Buffer.concat(stdout).toString("utf8");
  const usage = summarizeUsage(events);
  const finalMessage = existsSync(outputPath) ? readFileSync(outputPath, "utf8").trim() : "";
  const artifactPassed = item.role === "workspace_write"
    ? existsSync(path.join(fixture, WRITE_PATH)) && readFileSync(path.join(fixture, WRITE_PATH), "utf8") === WRITE_CONTENT
    : evaluateLocalQualification(item.role, { response: finalMessage }).passed;
  const passed = exitCode === 0 && !timedOut && !processError && artifactPassed && usage !== null;
  const result = {
    passed,
    detail: passed
      ? `exact ${item.role.replace("_", "-")} artifact returned`
      : processError ?? (timedOut ? "qualification timed out" : Buffer.concat(stderr).toString("utf8").trim() || "qualification artifact was incorrect"),
    durationMs: Date.now() - startedAtMs,
    usage,
  };
  rmSync(fixture, { recursive: true, force: true });
  return result;
}

function readJsonLines(filename) {
  if (!existsSync(filename)) return [];
  return readFileSync(filename, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function paidSpent(usageLedgerPath) {
  return existsSync(usageLedgerPath) ? summarizeLedger(readFileSync(usageLedgerPath, "utf8"), true) : 0;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseQualificationArgs(argv);
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
    discoveredCandidates: candidates.map(({ id, provider, model, tier, runtimeVersion }) => ({ id, provider, model, tier, runtimeVersion })),
    qualificationCount: plan.length,
    qualifications: plan.map(({ candidateId, provider, model, role, harness, fingerprint }) => ({ candidateId, provider, model, role, harness, fingerprint })),
    deferredPaidQualifications: completePlan.filter((item) => item.provider === "openai" && !options.includePaid).length,
  };
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return preview;
  }

  const stateRoot = path.join(ROOT, ".codex-factory");
  mkdirSync(stateRoot, { recursive: true });
  const qualificationLedgerPath = path.join(stateRoot, "qualifications.jsonl");
  const usageLedgerPath = path.join(stateRoot, "usage.jsonl");
  const results = [];
  for (const item of plan) {
    let reservation = null;
    if (item.paid) {
      reservation = item.tokenReservation;
      if (!Number.isSafeInteger(reservation) || reservation <= 0) throw new Error(`Paid candidate ${item.model} needs a token reservation`);
      const remaining = config.budgets.aggregatePaidTokens - paidSpent(usageLedgerPath);
      if (reservation > remaining) throw new Error(`Qualification for ${item.model} requires ${reservation} tokens; ${remaining} remain`);
      appendFileSync(usageLedgerPath, `${JSON.stringify({
        stage: "reserved",
        taskId: `qualify-${item.model}-${item.role}`,
        paid: true,
        reservedTokens: reservation,
        startedAt: new Date().toISOString(),
      })}\n`);
    }
    const result = item.provider === "ollama"
      ? await qualifyLocal(item, config.budgets.qualificationMinutes * 60_000)
      : await qualifyCodex(item, config.budgets.qualificationMinutes * 60_000);
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
      passed: result.passed,
      detail: result.detail,
      durationMs: result.durationMs,
      usage: result.usage,
      finishedAt: new Date().toISOString(),
    };
    appendFileSync(qualificationLedgerPath, `${JSON.stringify(record)}\n`);
    if (item.paid) {
      appendFileSync(usageLedgerPath, `${JSON.stringify({
        stage: "terminal",
        taskId: `qualify-${item.model}-${item.role}`,
        paid: true,
        usage: result.usage,
        finishedAt: record.finishedAt,
      })}\n`);
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
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
