#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverCandidatePool, discoverOllama, selectCandidate } from "./factory-fleet.mjs";
import { acquireFileLock, acquireWorkerSlot } from "./factory-slots.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OLLAMA_GENERATE_URL = "http://127.0.0.1:11434/api/generate";
const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PLAIN_EXECUTABLE_PATTERN = /^(?:[A-Za-z]:\\[^&|<>\r\n]+|\/[^&|<>\r\n]+|[A-Za-z0-9._-]+)$/;

function assertPositiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || (maximum && value > maximum)) {
    throw new Error(`${label} must be a positive integer${maximum ? ` no greater than ${maximum}` : ""}`);
  }
}

function normalizeRepositoryPath(value) {
  const windowsAbsolute = typeof value === "string" && (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value));
  if (typeof value !== "string" || !value || path.isAbsolute(value) || windowsAbsolute) {
    throw new Error(`Expected a relative repository path: ${value}`);
  }
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Expected a relative repository path without traversal: ${value}`);
  }
  if (segments.some((segment) => /[:*?"<>|\u0000-\u001f]/.test(segment))) {
    throw new Error(`Repository path contains unsafe characters: ${value}`);
  }
  return normalized;
}

export function validateLocalTask(task) {
  if (!task || task.version !== 1) throw new Error("Local task version must be 1");
  if (!TASK_ID_PATTERN.test(task.taskId ?? "")) throw new Error("Invalid local task ID");
  if (typeof task.repository !== "string" || !task.repository) throw new Error("Local task repository is required");
  if (typeof task.base !== "string" || !task.base || /[\r\n]/.test(task.base)) throw new Error("Local task base is required");
  if (task.model !== undefined && (typeof task.model !== "string" || !task.model || /[\r\n]/.test(task.model))) {
    throw new Error("Local task model override is invalid");
  }
  if (task.requiredTier !== undefined && !["economy", "standard", "premium"].includes(task.requiredTier)) {
    throw new Error("Local task requiredTier is invalid");
  }
  assertPositiveInteger(task.timeoutMinutes, "timeoutMinutes", 30);
  if (task.deadlineMs !== undefined && (!Number.isSafeInteger(task.deadlineMs) || task.deadlineMs <= Date.now())) throw new Error("deadlineMs must be a future millisecond timestamp");
  assertPositiveInteger(task.maxOutputTokens, "maxOutputTokens", 16_384);
  assertPositiveInteger(task.maxContextBytes, "maxContextBytes", 1_000_000);
  if (typeof task.instructions !== "string" || task.instructions.trim().length < 10) throw new Error("Local task instructions are incomplete");
  if (!Array.isArray(task.readPaths) || task.readPaths.length === 0) throw new Error("Local task needs at least one read path");
  if (!Array.isArray(task.writePaths) || task.writePaths.length === 0) throw new Error("Local task needs at least one write path");
  task.readPaths = [...new Set(task.readPaths.map(normalizeRepositoryPath))];
  task.writePaths = [...new Set(task.writePaths.map(normalizeRepositoryPath))];
  if (typeof task.check?.command !== "string" || !PLAIN_EXECUTABLE_PATTERN.test(task.check.command)) {
    throw new Error("check.command must be a plain executable name or absolute path");
  }
  if (!Array.isArray(task.check.args) || task.check.args.some((argument) => typeof argument !== "string" || /[\r\n]/.test(argument))) {
    throw new Error("check.args must be an array of argument strings");
  }
  if (typeof task.commitMessage !== "string" || !task.commitMessage.trim() || /[\r\n]/.test(task.commitMessage)) {
    throw new Error("commitMessage must be one nonempty line");
  }
  if ("tokenReservation" in task || "aggregateLocalTokens" in task) {
    throw new Error("Local tasks use time and capacity limits; token counts are telemetry");
  }
  return task;
}

function remainingAttemptMs(deadlineMs) {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) throw new Error("Local attempt deadline exhausted");
  return remaining;
}

export function buildOllamaRequest({ task, prompt }) {
  return {
    model: task.model,
    prompt,
    stream: false,
    think: false,
    format: {
      type: "object",
      properties: {
        files: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
        summary: { type: "string" },
      },
      required: ["files", "summary"],
      additionalProperties: false,
    },
    options: {
      num_predict: task.maxOutputTokens,
      temperature: 0,
    },
  };
}

export function parseOllamaResponse(responseText) {
  const response = JSON.parse(responseText);
  if (typeof response.response !== "string") throw new Error("Ollama response is missing the generated artifact");
  const artifact = JSON.parse(response.response);
  if (!Array.isArray(artifact.files) || artifact.files.length === 0) throw new Error("Local artifact files are empty");
  if (typeof artifact.summary !== "string" || !artifact.summary.trim()) throw new Error("Local artifact summary is empty");
  const promptTokens = Number(response.prompt_eval_count);
  const outputTokens = Number(response.eval_count);
  if (!Number.isSafeInteger(promptTokens) || !Number.isSafeInteger(outputTokens)) {
    throw new Error("Ollama response is missing token telemetry");
  }
  return {
    artifact,
    telemetry: {
      promptTokens,
      outputTokens,
      totalTokens: promptTokens + outputTokens,
      totalDurationNs: Number(response.total_duration),
    },
  };
}

export function validateGeneratedFiles(files, allowedWritePaths) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("Generated files are empty");
  const allowed = new Set(allowedWritePaths.map(normalizeRepositoryPath));
  const seen = new Set();
  for (const file of files) {
    if (!file || typeof file.content !== "string") throw new Error("Generated file needs path and string content");
    const normalized = normalizeRepositoryPath(file.path);
    if (!allowed.has(normalized)) throw new Error(`Generated file writes outside allowed write paths: ${normalized}`);
    if (seen.has(normalized)) throw new Error(`Generated artifact repeats a path: ${normalized}`);
    if (file.content.includes("\u0000")) throw new Error(`Generated file contains binary content: ${normalized}`);
    file.path = normalized;
    seen.add(normalized);
  }
  return files;
}

export function validateCheckWorkspace(unstagedPaths, untrackedPaths) {
  if (unstagedPaths.length) {
    throw new Error(`Required check modified candidate files: ${unstagedPaths.join(", ")}`);
  }
  if (untrackedPaths.length) {
    throw new Error(`Required check created untracked files: ${untrackedPaths.join(", ")}`);
  }
}

function git(args, cwd, options = {}) {
  const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  }
  return result;
}

function assertGitRoot(repository) {
  const result = git(["rev-parse", "--show-toplevel"], repository);
  const actual = realpathSync(result.stdout.trim());
  const requested = realpathSync(repository);
  if (actual.toLowerCase() !== requested.toLowerCase()) {
    throw new Error(`repository must name the Git root: ${actual}`);
  }
  return actual;
}

function resolveExistingFile(repository, relativePath) {
  const candidate = path.resolve(repository, relativePath);
  const actual = realpathSync(candidate);
  const rootPrefix = `${realpathSync(repository)}${path.sep}`.toLowerCase();
  if (!actual.toLowerCase().startsWith(rootPrefix)) throw new Error(`Path escapes repository through a link: ${relativePath}`);
  if (!statSync(actual).isFile()) throw new Error(`Task context path is not a file: ${relativePath}`);
  return actual;
}

function resolveWritableFile(repository, relativePath) {
  const candidate = path.resolve(repository, relativePath);
  const lexicalParent = path.dirname(candidate);
  const parent = realpathSync(lexicalParent);
  const root = realpathSync(repository);
  const rootPrefix = `${root}${path.sep}`.toLowerCase();
  if (parent.toLowerCase() !== root.toLowerCase() && !parent.toLowerCase().startsWith(rootPrefix)) {
    throw new Error(`Write path escapes repository through a link: ${relativePath}`);
  }
  if (parent.toLowerCase() !== lexicalParent.toLowerCase()) throw new Error(`Write path uses a linked parent: ${relativePath}`);
  if (existsSync(candidate)) {
    if (lstatSync(candidate).isSymbolicLink()) throw new Error(`Write path is a symbolic link: ${relativePath}`);
    resolveExistingFile(repository, relativePath);
  }
  return candidate;
}

function buildPrompt(task, repository) {
  const sections = [];
  let contextBytes = 0;
  const contextPaths = [...new Set([...task.readPaths, ...task.writePaths])];
  for (const relativePath of contextPaths) {
    const absolutePath = path.resolve(repository, relativePath);
    const exists = existsSync(absolutePath);
    const contents = exists ? readFileSync(resolveExistingFile(repository, relativePath), "utf8") : "<FILE DOES NOT EXIST>";
    contextBytes += Buffer.byteLength(contents, "utf8");
    if (contextBytes > task.maxContextBytes) throw new Error(`Task context exceeds ${task.maxContextBytes} byte safety limit`);
    sections.push(`--- ${relativePath} ---\n${contents}`);
  }
  return `You are a bounded local patch worker. Do not call tools, delegate, or describe intended future work.
Return one JSON object matching the requested schema. Each files item must contain the complete final text for that path.
Change only these paths: ${task.writePaths.join(", ")}
Do not return unchanged files, binary content, commentary, Markdown, or a diff.

Task:
${task.instructions}

Repository context:
${sections.join("\n\n")}
`;
}

async function requestOllama(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(OLLAMA_GENERATE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}: ${text}`);
    return text;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`Local model exceeded ${Math.round(timeoutMs / 60_000)} minute wall-clock limit`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
  }
}

async function runCheck(check, cwd, timeoutMs) {
  const startedAtMs = Date.now();
  const child = spawn(check.command, check.args, {
    cwd,
    detached: process.platform !== "win32",
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    terminateProcessTree(child);
  }, timeoutMs);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  clearTimeout(timer);
  return {
    command: check.command,
    args: check.args,
    exitCode,
    timedOut,
    elapsedMs: Date.now() - startedAtMs,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

function parseArgs(argv) {
  const options = { execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--execute") {
      options.execute = true;
      continue;
    }
    if (token !== "--task-file") throw new Error(`Unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value for --task-file");
    options.taskFile = value;
    index += 1;
  }
  if (!options.taskFile) throw new Error("Missing --task-file");
  return options;
}

function taskWasAttempted(ledgerPath, taskId) {
  if (!existsSync(ledgerPath)) return false;
  return readFileSync(ledgerPath, "utf8").split(/\r?\n/).filter(Boolean)
    .some((line) => JSON.parse(line).taskId === taskId);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const taskFile = path.resolve(options.taskFile);
  const task = validateLocalTask(JSON.parse(readFileSync(taskFile, "utf8")));
  const config = JSON.parse(readFileSync(path.join(ROOT, "factory.config.json"), "utf8"));
  const ollama = await discoverOllama();
  const candidates = discoverCandidatePool({ config, ollama }).filter((candidate) => candidate.provider === "ollama");
  const qualificationPath = path.join(ROOT, ".codex-factory", "qualifications.jsonl");
  const qualifications = existsSync(qualificationPath)
    ? readFileSync(qualificationPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const selected = selectCandidate({
    candidates: task.model ? candidates.filter((candidate) => candidate.model === task.model) : candidates,
    qualifications,
    role: "structured_write",
    requiredTier: task.requiredTier ?? "standard",
  });
  task.model = selected.model;
  const repository = assertGitRoot(path.resolve(task.repository));
  const stateRoot = path.resolve(ROOT, ".codex-factory", "local-patch");
  const ledgerPath = path.resolve(stateRoot, "ledger.jsonl");
  const preview = {
    taskId: task.taskId,
    provider: "ollama",
    model: task.model,
    repository,
    base: task.base,
    readPaths: task.readPaths,
    writePaths: task.writePaths,
    check: task.check,
    timeoutMinutes: task.timeoutMinutes,
    maxOutputTokens: task.maxOutputTokens,
    maxContextBytes: task.maxContextBytes,
    tokenAccounting: "telemetry-only",
    selectionFactors: selected.factors,
    execute: options.execute,
  };
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return preview;
  }

  mkdirSync(stateRoot, { recursive: true });
  const slot = acquireWorkerSlot(path.resolve(ROOT, ".codex-factory"), config.budgets.maxConcurrentWorkers, {
    taskId: task.taskId,
    provider: "ollama",
    model: task.model,
  });

  let runPath = null;
  let worktreePath = null;
  let branch = null;
  try {
    const deadlineMs = task.deadlineMs ?? Date.now() + task.timeoutMinutes * 60_000;
    const startedAt = new Date();
    const runId = `${startedAt.toISOString().replace(/[:.]/g, "-")}-${task.taskId}`;
    runPath = path.resolve(stateRoot, "runs", runId);
    worktreePath = path.resolve(stateRoot, "worktrees", runId);
    branch = `codex-factory/${task.taskId}-${startedAt.getTime()}`;
    mkdirSync(runPath, { recursive: true });
    mkdirSync(path.dirname(worktreePath), { recursive: true });
    const ledgerLock = await acquireFileLock(path.resolve(stateRoot, "ledger.lock"), { taskId: task.taskId });
    try {
      if (taskWasAttempted(ledgerPath, task.taskId)) throw new Error(`Task ${task.taskId} already has an attempt`);
      appendFileSync(ledgerPath, `${JSON.stringify({
        stage: "started",
        runId,
        taskId: task.taskId,
        provider: "ollama",
        model: task.model,
        paid: false,
        startedAt: startedAt.toISOString(),
      })}\n`);
    } finally {
      ledgerLock.release();
    }
    git(["worktree", "add", "-b", branch, worktreePath, task.base], repository);
    const prompt = buildPrompt(task, worktreePath);
    const request = buildOllamaRequest({ task, prompt });
    writeFileSync(path.resolve(runPath, "request.json"), `${JSON.stringify({ ...preview, execute: true, runId, worktreePath, branch, taskFile, prompt }, null, 2)}\n`);
    const baseline = await runCheck(task.check, worktreePath, remainingAttemptMs(deadlineMs));
    writeFileSync(path.resolve(runPath, "baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`);

    const rawResponse = await requestOllama(request, remainingAttemptMs(deadlineMs));
    writeFileSync(path.resolve(runPath, "ollama-response.json"), `${rawResponse}\n`);
    const generated = parseOllamaResponse(rawResponse);
    const generatedFiles = validateGeneratedFiles(generated.artifact.files, task.writePaths);
    writeFileSync(path.resolve(runPath, "candidate.json"), `${JSON.stringify(generated.artifact, null, 2)}\n`);
    for (const file of generatedFiles) {
      writeFileSync(resolveWritableFile(worktreePath, file.path), file.content);
      git(["add", "--", file.path], worktreePath);
    }
    const changedPaths = generatedFiles.map((file) => file.path);
    const stagedPaths = git(["diff", "--cached", "--name-only"], worktreePath).stdout.trim().split(/\r?\n/).filter(Boolean);
    if (JSON.stringify(stagedPaths.sort()) !== JSON.stringify([...changedPaths].sort())) {
      throw new Error("Staged paths differ from the validated generated files");
    }
    writeFileSync(path.resolve(runPath, "candidate.patch"), git(["diff", "--cached", "--binary"], worktreePath).stdout);
    const check = await runCheck(task.check, worktreePath, remainingAttemptMs(deadlineMs));
    writeFileSync(path.resolve(runPath, "check.json"), `${JSON.stringify(check, null, 2)}\n`);
    if (check.timedOut || check.exitCode !== 0) throw new Error(`Required check failed with exit ${check.exitCode}`);
    validateCheckWorkspace(
      git(["diff", "--name-only"], worktreePath).stdout.trim().split(/\r?\n/).filter(Boolean),
      git(["ls-files", "--others", "--exclude-standard"], worktreePath).stdout.trim().split(/\r?\n/).filter(Boolean),
    );
    git(["commit", "-m", task.commitMessage], worktreePath);
    const commit = git(["rev-parse", "HEAD"], worktreePath).stdout.trim();
    const result = {
      ...preview,
      execute: true,
      stage: "terminal",
      status: "accepted",
      runId,
      runPath,
      worktreePath,
      branch,
      commit,
      changedPaths,
      baseline,
      check,
      summary: generated.artifact.summary,
      telemetry: generated.telemetry,
      finishedAt: new Date().toISOString(),
    };
    writeFileSync(path.resolve(runPath, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    const terminalLock = await acquireFileLock(path.resolve(stateRoot, "ledger.lock"), { taskId: task.taskId, stage: "terminal" });
    try {
      appendFileSync(ledgerPath, `${JSON.stringify(result)}\n`);
    } finally {
      terminalLock.release();
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    let cleanupError = null;
    if (worktreePath) {
      const worktreeRoot = `${path.resolve(stateRoot, "worktrees")}${path.sep}`.toLowerCase();
      if (!worktreePath.toLowerCase().startsWith(worktreeRoot)) {
        cleanupError = "Refused to clean a worktree outside local-patch state";
      } else {
        const removal = git(["worktree", "remove", "--force", worktreePath], repository, { allowFailure: true });
        if (removal.status !== 0 && existsSync(worktreePath)) cleanupError = `${removal.stdout}${removal.stderr}`.trim();
        if (branch) {
          const branchRemoval = git(["branch", "-D", branch], repository, { allowFailure: true });
          if (branchRemoval.status !== 0) cleanupError ??= `${branchRemoval.stdout}${branchRemoval.stderr}`.trim();
        }
      }
    }
    const result = {
      ...preview,
      execute: true,
      stage: "terminal",
      status: "failed",
      runPath,
      error: error.message,
      cleanupError,
      finishedAt: new Date().toISOString(),
    };
    if (runPath) writeFileSync(path.resolve(runPath, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    const terminalLock = await acquireFileLock(path.resolve(stateRoot, "ledger.lock"), { taskId: task.taskId, stage: "terminal" });
    try {
      appendFileSync(ledgerPath, `${JSON.stringify(result)}\n`);
    } finally {
      terminalLock.release();
    }
    throw error;
  } finally {
    slot.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
