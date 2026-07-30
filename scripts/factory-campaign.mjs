import { selectCandidate } from "./factory-fleet.mjs";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const ROLES = new Set(["mechanical", "standard", "review", "critical", "local-read"]);
const PLAIN_EXECUTABLE_PATTERN = /^(?:[A-Za-z]:\\[^&|<>\r\n]+|\/[^&|<>\r\n]+|[A-Za-z0-9._-]+)$/;

function normalizePath(value, label) {
  if (typeof value !== "string" || !value || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\")) {
    throw new Error(`${label} must be a relative repository path`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} must not contain empty or traversal segments`);
  }
  return normalized;
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function remainingAttemptMs(deadlineMs, nowMs = Date.now()) {
  const remaining = deadlineMs - nowMs;
  if (remaining <= 0) throw new Error("Local attempt deadline exhausted");
  return remaining;
}

function tasksAccessOverlap(left, right) {
  return left.writePaths.some((leftPath) =>
    [...right.readPaths, ...right.writePaths].some((rightPath) => pathsOverlap(leftPath, rightPath)))
    || right.writePaths.some((rightPath) => left.readPaths.some((leftPath) => pathsOverlap(rightPath, leftPath)));
}

function dependsOn(tasksById, taskId, possibleAncestor, seen = new Set()) {
  if (seen.has(taskId)) return false;
  seen.add(taskId);
  const task = tasksById.get(taskId);
  if (!task) return false;
  if (task.dependsOn.includes(possibleAncestor)) return true;
  return task.dependsOn.some((dependency) => dependsOn(tasksById, dependency, possibleAncestor, seen));
}

export function validateCampaign(value) {
  if (!value || value.version !== 1) throw new Error("Campaign version must be 1");
  if (!ID_PATTERN.test(value.campaignId ?? "")) throw new Error("Invalid campaign ID");
  if (typeof value.repository !== "string" || !value.repository) throw new Error("Campaign repository is required");
  if (typeof value.base !== "string" || !value.base || /[\r\n]/.test(value.base)) throw new Error("Campaign base is required");
  if (!Number.isSafeInteger(value.maxParallel) || value.maxParallel < 1 || value.maxParallel > 4) {
    throw new Error("Campaign maxParallel must be between 1 and 4");
  }
  if (value.localAttemptMinutes !== undefined
    && (!Number.isSafeInteger(value.localAttemptMinutes) || value.localAttemptMinutes < 1 || value.localAttemptMinutes > 30)) {
    throw new Error("Campaign local attempt minutes must be between 1 and 30");
  }
  if (Boolean(value.sourceFile) === Boolean(value.source)) throw new Error("Campaign needs exactly one of sourceFile or source");
  if (value.sourceFile !== undefined) value.sourceFile = normalizePath(value.sourceFile, "Campaign sourceFile");
  if (value.source !== undefined && (typeof value.source !== "string" || value.source.trim().length < 10)) {
    throw new Error("Campaign source is incomplete");
  }
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) throw new Error("Campaign needs at least one task");

  const ids = new Set();
  for (const task of value.tasks) {
    if (!ID_PATTERN.test(task?.id ?? "")) throw new Error(`Invalid campaign task ID: ${task?.id}`);
    if (ids.has(task.id)) throw new Error(`Duplicate campaign task ID: ${task.id}`);
    ids.add(task.id);
    if (!ROLES.has(task.role) || task.role === "critical") throw new Error(`Unsupported campaign task role: ${task.role}`);
    if (typeof task.instructions !== "string" || task.instructions.trim().length < 10) {
      throw new Error(`Task ${task.id} instructions are incomplete`);
    }
    if (!Array.isArray(task.readPaths) || task.readPaths.length === 0) throw new Error(`Task ${task.id} needs readPaths`);
    if (!Array.isArray(task.writePaths) || task.writePaths.length === 0) throw new Error(`Task ${task.id} needs writePaths`);
    task.readPaths = [...new Set(task.readPaths.map((entry) => normalizePath(entry, `Task ${task.id} read path`)))];
    task.writePaths = [...new Set(task.writePaths.map((entry) => normalizePath(entry, `Task ${task.id} write path`)))];
    if (!Array.isArray(task.dependsOn)) throw new Error(`Task ${task.id} dependsOn must be an array`);
    if (typeof task.parallelSafe !== "boolean") throw new Error(`Task ${task.id} must declare parallelSafe`);
    if (typeof task.check?.command !== "string" || !PLAIN_EXECUTABLE_PATTERN.test(task.check.command)) {
      throw new Error(`Task ${task.id} check.command must be a plain executable`);
    }
    if (!Array.isArray(task.check.args) || task.check.args.some((argument) => typeof argument !== "string" || /[\r\n]/.test(argument))) {
      throw new Error(`Task ${task.id} check.args must be strings`);
    }
    if (typeof task.commitMessage !== "string" || !task.commitMessage.trim() || /[\r\n]/.test(task.commitMessage)) {
      throw new Error(`Task ${task.id} commitMessage must be one line`);
    }
  }

  const tasksById = new Map(value.tasks.map((task) => [task.id, task]));
  for (const task of value.tasks) {
    for (const dependency of task.dependsOn) {
      if (!tasksById.has(dependency)) throw new Error(`Task ${task.id} has unknown dependency ${dependency}`);
      if (dependency === task.id || dependsOn(tasksById, dependency, task.id)) throw new Error(`Campaign dependency cycle includes ${task.id}`);
    }
  }
  for (let leftIndex = 0; leftIndex < value.tasks.length; leftIndex += 1) {
    const left = value.tasks[leftIndex];
    if (!left.parallelSafe) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < value.tasks.length; rightIndex += 1) {
      const right = value.tasks[rightIndex];
      if (!right.parallelSafe
        || dependsOn(tasksById, left.id, right.id)
        || dependsOn(tasksById, right.id, left.id)) continue;
      if (tasksAccessOverlap(left, right)) {
        throw new Error(`Parallel tasks ${left.id} and ${right.id} overlap read/write paths`);
      }
    }
  }
  return value;
}

export function selectReadyBatch(tasks, completed, running, maxParallel) {
  const ready = tasks.filter((task) =>
    !completed.has(task.id)
    && !running.has(task.id)
    && task.dependsOn.every((dependency) => completed.has(dependency)));
  if (!ready.length) return [];
  if (!ready[0].parallelSafe) return [ready[0]];
  const selected = [];
  const selectedReads = [];
  const selectedWrites = [];
  for (const task of ready) {
    if (!task.parallelSafe || selected.length >= maxParallel) continue;
    if (task.writePaths.some((candidate) => [...selectedReads, ...selectedWrites].some((selectedPath) => pathsOverlap(candidate, selectedPath)))
      || task.readPaths.some((candidate) => selectedWrites.some((selectedPath) => pathsOverlap(candidate, selectedPath)))) continue;
    selected.push(task);
    selectedReads.push(...task.readPaths);
    selectedWrites.push(...task.writePaths);
  }
  return selected;
}

export function buildAttemptLadder({ task, candidates, qualifications, routes = {} }) {
  const localRole = ["mechanical", "review", "local-read"].includes(task.role) ? "analysis" : "structured_write";
  const paidRole = ["mechanical", "review", "local-read"].includes(task.role) ? "analysis" : "workspace_write";
  const requiredTier = task.role === "critical" ? "premium" : (routes[task.role]?.requiredTier ?? "economy");
  const attempts = [];
  const localCandidates = candidates.filter((candidate) => candidate.provider === "ollama");
  try {
    const local = selectCandidate({
      candidates: localCandidates,
      qualifications,
      role: localRole,
      requiredTier,
    });
    attempts.push({ ...local, runner: localRole === "structured_write" ? "local-patch" : "codex-worker" });
  } catch {}

  for (const model of ["gpt-5.6-luna", "gpt-5.6-terra"]) {
    const matching = candidates.filter((candidate) => candidate.provider === "openai" && candidate.model === model);
    if (!matching.length) continue;
    try {
      const selected = selectCandidate({
        candidates: matching,
        qualifications,
        role: paidRole,
        requiredTier,
      });
      attempts.push({ ...selected, runner: "codex-worker" });
    } catch {}
  }
  return attempts;
}

export async function runTaskWithFallback({ task, attempts, executeAttempt }) {
  if (!attempts.length) throw new Error(`Task ${task.id} has no qualified local, Luna, or Terra candidate`);
  const failures = [];
  for (const attempt of attempts) {
    try {
      const result = await executeAttempt(task, attempt);
      if (!result || !["accepted", "process_completed"].includes(result.status)) {
        const error = new Error(`attempt ended with ${result?.status ?? "no result"}`);
        error.code = "WORKER_ATTEMPT_FAILED";
        throw error;
      }
      return { taskId: task.id, selected: attempt, result, commit: result.commit ?? null, failures };
    } catch (error) {
      if (error.code !== "WORKER_ATTEMPT_FAILED") throw error;
      failures.push({ provider: attempt.provider, model: attempt.model, error: error.message });
    }
  }
  const failure = new Error(`Task ${task.id} exhausted local, Luna, and Terra attempts`);
  failure.attempts = failures;
  throw failure;
}

export async function runCampaignSchedule({ plan, executeTask, integrateBatch }) {
  const completed = new Set();
  const running = new Set();
  const results = [];
  while (completed.size < plan.tasks.length) {
    const batch = selectReadyBatch(plan.tasks, completed, running, plan.maxParallel);
    if (!batch.length) throw new Error("Campaign cannot make progress; dependencies are blocked");
    for (const task of batch) running.add(task.id);
    let batchResults;
    try {
      const settled = await Promise.allSettled(batch.map((task) => executeTask(task)));
      const failed = settled.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
      batchResults = settled.map((result) => result.value);
    } finally {
      for (const task of batch) running.delete(task.id);
    }
    await integrateBatch(batchResults);
    for (const result of batchResults) {
      completed.add(result.taskId);
      results.push(result);
    }
  }
  return { status: "completed", results };
}
