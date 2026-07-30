#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareDeclaredWritePath } from "./factory-process.mjs";
import {
  buildAttemptLadder,
  remainingAttemptMs,
  runCampaignSchedule,
  runTaskWithFallback,
  validateCampaign,
} from "./factory-campaign.mjs";
import { discoverCandidatePool, discoverOllama } from "./factory-fleet.mjs";
import { validateConfig } from "./run-worker.mjs";
import { parseCliArgs, printHelp, reportCliError } from "./factory-cli.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = `Usage:
  node scripts/run-campaign.mjs --plan-file <file> [--execute]

Options:
  --plan-file <file>  Required coordinator-created campaign plan JSON.
  --execute           DANGEROUS: dispatch and integrate the campaign; otherwise dry-run.
  -h, --help          Show this help.`;

function parseArgs(argv) {
  const options = parseCliArgs(argv, {
    valueFlags: { "--plan-file": "planFile" },
    booleanFlags: { "--execute": "execute" },
    defaults: { execute: false },
  });
  if (options.help) return options;
  if (!options.planFile) throw new Error("Missing --plan-file");
  return options;
}

function git(args, cwd, { allowFailure = false } = {}) {
  const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`.trim());
  }
  return result;
}

function gitRoot(repository) {
  return path.resolve(git(["rev-parse", "--show-toplevel"], repository).stdout.trim());
}

function resolveCampaignSource(repository, sourceFile) {
  const root = realpathSync(repository);
  const source = realpathSync(path.resolve(root, sourceFile));
  const prefix = `${root}${path.sep}`.toLowerCase();
  if (!source.toLowerCase().startsWith(prefix) || !statSync(source).isFile()) {
    throw new Error("Campaign sourceFile must resolve to a regular file inside the repository");
  }
  return source;
}

function readJsonLines(filename) {
  if (!existsSync(filename)) return [];
  return readFileSync(filename, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function attemptId(campaignId, taskId, model) {
  const suffix = createHash("sha256").update(`${campaignId}:${taskId}:${model}`).digest("hex").slice(0, 8);
  return `${campaignId}-${taskId}-${suffix}`.slice(0, 64);
}

function pathAllowed(candidate, allowed) {
  const normalized = candidate.replaceAll("\\", "/");
  return allowed.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
}

function assertSafeWritePaths(repository, writePaths) {
  for (const relative of writePaths) {
    prepareDeclaredWritePath(repository, relative);
  }
}

function changedPaths(repository, base) {
  return [...new Set([
    ...git(["diff", "--name-only", base], repository).stdout.split(/\r?\n/),
    ...git(["ls-files", "--others", "--exclude-standard"], repository).stdout.split(/\r?\n/),
  ].filter(Boolean))];
}

function validateChangedPaths(repository, base, writePaths) {
  assertSafeWritePaths(repository, writePaths);
  const changed = changedPaths(repository, base);
  const outside = changed.filter((entry) => !pathAllowed(entry, writePaths));
  if (outside.length) throw new Error(`Worker changed paths outside the task contract: ${outside.join(", ")}`);
  return changed;
}

function terminateChild(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
  }
}

function runChild(command, args, cwd, activeChildren) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChildren?.add(child);
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      activeChildren?.delete(child);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const diagnostics = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(diagnostics || output || `${command} exited ${code}`));
        return;
      }
      try {
        resolve(output ? JSON.parse(output) : null);
      } catch {
        reject(new Error(`Worker returned an invalid JSON receipt: ${output.slice(0, 400)}`));
      }
    });
  });
}

function taskPrompt(task, source) {
  return `You are one leaf implementation worker in a Codex Factory campaign.
Implement only this task. Use repository tools directly. Do not delegate.

Campaign source:
${source}

Task:
${task.instructions}

Acceptance criteria
- Complete the task described above and satisfy the campaign source for this scope.
- Leave the declared required check runnable.

Allowed paths
${task.writePaths.map((entry) => `- ${entry}`).join("\n")}

Required checks
- ${task.check.command} ${task.check.args.join(" ")}

Do not delegate
- Do not spawn agents or hand work to another model.
- Do not modify paths outside Allowed paths.
- Do not commit; the coordinator owns the task commit.
`;
}

function runCheck(task, cwd, timeoutMs = 30 * 60_000) {
  const result = spawnSync(task.check.command, task.check.args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Required check failed (${result.status}): ${result.stderr || result.stdout}`.trim());
  return {
    command: task.check.command,
    args: task.check.args,
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function cleanupWorktree(repository, result) {
  if (!result?.worktreePath) return null;
  const removal = git(["worktree", "remove", "--force", result.worktreePath], repository, { allowFailure: true });
  const branchRemoval = result.branch
    ? git(["branch", "-D", result.branch], repository, { allowFailure: true })
    : { status: 0, stdout: "", stderr: "" };
  if (removal.status !== 0 || branchRemoval.status !== 0) {
    return `${removal.stdout}${removal.stderr}${branchRemoval.stdout}${branchRemoval.stderr}`.trim() || "Worker cleanup failed";
  }
  return null;
}

function cleanupIntegrationWorktree(repository, integrationPath, integrationBranch) {
  const removal = git(["worktree", "remove", "--force", integrationPath], repository, { allowFailure: true });
  const branchRemoval = git(["branch", "-D", integrationBranch], repository, { allowFailure: true });
  if (removal.status !== 0 || branchRemoval.status !== 0) {
    return `${removal.stdout}${removal.stderr}${branchRemoval.stdout}${branchRemoval.stderr}`.trim() || "Integration cleanup failed";
  }
  return null;
}

function recordCleanup(runPath, kind, result, cleanupError) {
  appendFileSync(path.join(runPath, "cleanup.jsonl"), `${JSON.stringify({
    kind,
    worktreePath: result?.worktreePath ?? null,
    branch: result?.branch ?? null,
    cleanupError,
    recordedAt: new Date().toISOString(),
  })}\n`);
}

async function executeLocalAttempt({ plan, task, attempt, repository, base, source, runPath, config, activeChildren }) {
  const deadlineMs = Date.now() + Math.min(plan.localAttemptMinutes ?? 3, 30) * 60_000;
  const taskId = attemptId(plan.campaignId, task.id, attempt.model);
  const taskPath = path.join(runPath, "tasks", `${taskId}.json`);
  mkdirSync(path.dirname(taskPath), { recursive: true });
  writeFileSync(taskPath, `${JSON.stringify({
    version: 1,
    taskId,
    repository,
    base,
    model: attempt.model,
    requiredTier: config.routes[task.role].requiredTier,
    deadlineMs,
    timeoutMinutes: Math.max(1, Math.ceil(remainingAttemptMs(deadlineMs) / 60_000)),
    maxOutputTokens: 8_192,
    maxContextBytes: 500_000,
    instructions: `${task.instructions}\n\nCampaign source:\n${source}`,
    readPaths: task.readPaths,
    writePaths: task.writePaths,
    check: task.check,
    commitMessage: task.commitMessage,
  }, null, 2)}\n`);
  return runChild(process.execPath, [path.join(ROOT, "scripts", "run-local-patch.mjs"), "--task-file", taskPath, "--execute"], ROOT, activeChildren);
}

async function executeCodexAttempt({
  plan,
  task,
  attempt,
  repository,
  base,
  source,
  runPath,
  config,
  activeChildren,
  launchWorker,
}) {
  const deadlineMs = attempt.provider === "ollama"
    ? Date.now() + Math.min(plan.localAttemptMinutes ?? 3, 30) * 60_000
    : null;
  const taskId = attemptId(plan.campaignId, task.id, attempt.model);
  const label = attempt.model.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const worktreePath = path.join(runPath, "worktrees", `${task.id}-${label}`);
  const branch = `codex-factory/${plan.campaignId}-${task.id}-${label}-${Date.now()}`;
  mkdirSync(path.dirname(worktreePath), { recursive: true });
  git(["worktree", "add", "-b", branch, worktreePath, base], repository);
  assertSafeWritePaths(worktreePath, task.writePaths);
  const promptPath = path.join(runPath, "tasks", `${taskId}.md`);
  mkdirSync(path.dirname(promptPath), { recursive: true });
  writeFileSync(promptPath, taskPrompt(task, source));
  try {
    const workerCommand = process.execPath;
    const workerArgs = [
      path.join(ROOT, "scripts", "run-worker.mjs"),
      "--task-id", taskId,
      "--role", task.role,
      "--candidate-id", attempt.id,
      "--timeout-minutes", String(deadlineMs ? Math.max(1, Math.ceil(remainingAttemptMs(deadlineMs) / 60_000)) : config.budgets.maxWorkerMinutes),
      "--cwd", worktreePath,
      "--prompt-file", promptPath,
      "--execute",
    ];
    const worker = launchWorker
      ? await launchWorker({
        command: workerCommand,
        args: workerArgs,
        cwd: ROOT,
        activeChildren,
        task,
        attempt,
        taskId,
        worktreePath,
        promptPath,
      })
      : await runChild(workerCommand, workerArgs, ROOT, activeChildren);
    if (worker.status !== "process_completed") throw new Error(`Worker ended with ${worker.status}`);
    assertSafeWritePaths(worktreePath, task.writePaths);
    let uniqueChanged = validateChangedPaths(worktreePath, base, task.writePaths);
    if (!uniqueChanged.length) throw new Error("Worker produced no repository changes");
    const check = runCheck(task, worktreePath, deadlineMs ? remainingAttemptMs(deadlineMs) : undefined);
    uniqueChanged = validateChangedPaths(worktreePath, base, task.writePaths);
    if (!uniqueChanged.length) throw new Error("Required check removed all worker changes");
    git(["reset"], worktreePath);
    git(["add", "--all", "--", ...task.writePaths], worktreePath);
    const stagedPaths = git(["diff", "--cached", "--name-only"], worktreePath).stdout.trim().split(/\r?\n/).filter(Boolean);
    const staged = stagedPaths.join("\n");
    const missing = uniqueChanged.filter((entry) => !stagedPaths.includes(entry));
    if (missing.length) throw new Error(`Validated paths were not staged: ${missing.join(", ")}`);
    if (staged) git(["commit", "-m", task.commitMessage], worktreePath);
    const commit = git(["rev-parse", "HEAD"], worktreePath).stdout.trim();
    if (commit === base) throw new Error("Worker changes did not produce a commit");
    return {
      status: "accepted",
      provider: attempt.provider,
      model: attempt.model,
      commit,
      branch,
      worktreePath,
      changedPaths: uniqueChanged,
      check,
      worker,
    };
  } catch (error) {
    const cleanupError = cleanupWorktree(repository, { worktreePath, branch });
    recordCleanup(runPath, "failed-worker", { worktreePath, branch }, cleanupError);
    if (cleanupError) throw new AggregateError([error, new Error(`Worker cleanup failed: ${cleanupError}`)], "Worker attempt and cleanup failed");
    throw error;
  }
}

export async function runCampaign({
  planFile,
  execute = false,
  stateRoot = ROOT,
  resolveAttempts,
  launchWorker,
}) {
  const planPath = path.resolve(planFile);
  const plan = validateCampaign(JSON.parse(readFileSync(planPath, "utf8")));
  const repository = gitRoot(path.resolve(plan.repository));
  const sourcePath = plan.sourceFile ? resolveCampaignSource(repository, plan.sourceFile) : null;
  const source = plan.source ?? readFileSync(sourcePath, "utf8");
  const config = validateConfig(JSON.parse(readFileSync(path.join(ROOT, "factory.config.json"), "utf8")));
  if (plan.maxParallel > config.budgets.maxConcurrentWorkers) {
    throw new Error(`Campaign maxParallel exceeds configured worker slots (${config.budgets.maxConcurrentWorkers})`);
  }
  const ollama = await discoverOllama().catch(() => ({ runtimeVersion: "unavailable", models: [] }));
  const candidates = discoverCandidatePool({ config, ollama });
  const qualifications = readJsonLines(path.join(ROOT, ".codex-factory", "qualifications.jsonl"));
  const ladders = Object.fromEntries(plan.tasks.map((task) => [
    task.id,
    resolveAttempts
      ? resolveAttempts({ task, plan, candidates, qualifications, config })
      : buildAttemptLadder({ task, candidates, qualifications, routes: config.routes }),
  ]));
  for (const task of plan.tasks) {
    if (!ladders[task.id].length) {
      throw new Error(
        `Campaign preview cannot route task "${task.id}" (role "${task.role}"): no currently qualified attempts. `
        + "Preview candidate qualification with `npm.cmd run fleet:qualify`, then run the applicable qualification before previewing this campaign again.",
      );
    }
  }
  const preview = {
    campaignId: plan.campaignId,
    repository,
    base: plan.base,
    sourcePath,
    maxParallel: plan.maxParallel,
    tasks: plan.tasks.map((task) => ({
      id: task.id,
      dependsOn: task.dependsOn,
      parallelSafe: task.parallelSafe,
      attempts: ladders[task.id].map(({ provider, model }) => ({ provider, model })),
    })),
    execute,
  };
  if (!execute) return preview;

  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replace(/[:.]/g, "-")}-${plan.campaignId}`;
  const runPath = path.join(path.resolve(stateRoot), ".codex-factory", "campaigns", runId);
  const integrationPath = path.join(runPath, "integration");
  const integrationBranch = `codex-factory/campaign-${plan.campaignId}-${startedAt.getTime()}`;
  const unintegrated = new Set();
  const activeChildren = new Set();
  let interrupted = null;
  const interrupt = (signal) => {
    interrupted ??= new Error(`Campaign interrupted by ${signal}`);
    for (const child of activeChildren) terminateChild(child);
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  mkdirSync(runPath, { recursive: true });
  writeFileSync(path.join(runPath, "request.json"), `${JSON.stringify({ ...preview, execute: true, planPath }, null, 2)}\n`);
  if (interrupted) throw interrupted;
  git(["worktree", "add", "-b", integrationBranch, integrationPath, plan.base], repository);
  try {
    const schedule = await runCampaignSchedule({
      plan,
      executeTask: async (task) => {
        if (interrupted) throw interrupted;
        const base = git(["rev-parse", "HEAD"], integrationPath).stdout.trim();
        const taskResult = await runTaskWithFallback({
          task,
          attempts: ladders[task.id],
          executeAttempt: async (_task, attempt) => {
            if (interrupted) throw interrupted;
            const context = { plan, task, attempt, repository, base, source, runPath, config, activeChildren, launchWorker };
            const result = attempt.runner === "local-patch"
              ? await executeLocalAttempt(context)
              : await executeCodexAttempt(context);
            unintegrated.add(result);
            return result;
          },
        });
        return taskResult;
      },
      integrateBatch: async (batch) => {
        for (const item of batch) {
          if (!item.commit) continue;
          git(["cherry-pick", item.commit], integrationPath);
          const cleanupError = cleanupWorktree(repository, item.result);
          recordCleanup(runPath, "accepted-worker", item.result, cleanupError);
          if (cleanupError) throw new Error(`Accepted worker cleanup failed: ${cleanupError}`);
          unintegrated.delete(item.result);
        }
      },
    });
    const result = {
      ...preview,
      execute: true,
      status: schedule.status,
      runId,
      runPath,
      integrationBranch,
      integrationPath,
      commit: git(["rev-parse", "HEAD"], integrationPath).stdout.trim(),
      tasks: schedule.results,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
    writeFileSync(path.join(runPath, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    for (const result of unintegrated) {
      const workerCleanupError = cleanupWorktree(repository, result);
      recordCleanup(runPath, "failed-worker", result, workerCleanupError);
    }
    const cleanupError = cleanupIntegrationWorktree(repository, integrationPath, integrationBranch);
    recordCleanup(runPath, "integration", { worktreePath: integrationPath, branch: integrationBranch }, cleanupError);
    const failure = {
      ...preview,
      execute: true,
      status: "failed",
      runId,
      runPath,
      integrationBranch,
      integrationPath,
      error: error.message,
      cleanupError,
      attempts: error.attempts ?? null,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
    writeFileSync(path.join(runPath, "result.json"), `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    for (const child of activeChildren) terminateChild(child);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp(USAGE);
    return null;
  }
  const result = await runCampaign({
    planFile: options.planFile,
    execute: options.execute,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(reportCliError);
}
