import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { superviseProcess } from "../scripts/factory-process.mjs";

const PROJECT = path.resolve(import.meta.dirname, "..");
const FAKE_CODEX = path.join(import.meta.dirname, "fixtures", "fake-codex.mjs");
const FAKE_OLLAMA = path.join(import.meta.dirname, "fixtures", "fake-ollama.mjs");

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

function git(repository, args) {
  const result = run("git", args, { cwd: repository });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function isolatedFactory() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-factory-boundary-"));
  cpSync(path.join(PROJECT, "scripts"), path.join(root, "scripts"), { recursive: true });
  for (const name of ["package.json", "factory.config.json"]) cpSync(path.join(PROJECT, name), path.join(root, name));
  mkdirSync(path.join(root, ".codex-factory"), { recursive: true });
  return root;
}

function fakeEnvironment(root, markerPath, extra = {}) {
  return {
    ...process.env,
    CODEX_FACTORY_CODEX_SHIM: FAKE_CODEX,
    CODEX_FACTORY_TEST_STATE_ROOT: path.join(root, ".codex-factory"),
    CODEX_FACTORY_TEST_MARKER: markerPath,
    ...extra,
  };
}

function records(filename) {
  return existsSync(filename)
    ? readFileSync(filename, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    : [];
}

function assertReservedThenReconciled(entries, taskId, started) {
  const reservation = entries.find((entry) => entry.taskId === taskId && entry.stage === "reserved");
  const terminal = entries.find((entry) => entry.taskId === taskId && entry.stage === "terminal");
  assert.ok(reservation, `missing reservation for ${taskId}`);
  assert.ok(terminal, `missing reconciliation for ${taskId}`);
  assert.equal(terminal.invocationId, reservation.invocationId);
  assert.deepEqual(terminal.usage, { input_tokens: 11, output_tokens: 7, total_tokens: 18 });
  const launch = started.find((entry) => entry.taskId === taskId);
  assert.equal(launch.invocationId, reservation.invocationId);
  assert.ok(launch.ledgerLength >= 1, "reservation must be visible before spawn");
}

function qualify(root, markerPath, role = "workspace_write") {
  return run(process.execPath, [
    path.join(root, "scripts", "qualify-fleet.mjs"),
    "--provider", "openai",
    "--model", "gpt-5.6-luna",
    "--role", role,
    "--include-paid",
    "--execute",
  ], { cwd: root, env: fakeEnvironment(root, markerPath) });
}

function startFakeOllama() {
  const child = spawn(process.execPath, [FAKE_OLLAMA], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("message", ({ port }) => resolve({
      child,
      baseUrl: `http://127.0.0.1:${port}`,
    }));
  });
}

function stopFakeOllama(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  child.send("close");
  return new Promise((resolve) => child.once("close", resolve));
}

test("paid qualification crosses a fake executable only after reservation and reconciles the same invocation", () => {
  const root = isolatedFactory();
  const markerPath = path.join(root, "starts.jsonl");
  const result = qualify(root, markerPath);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const ledger = records(path.join(root, ".codex-factory", "usage.jsonl"));
  const started = records(markerPath);
  assertReservedThenReconciled(ledger, "qualify-gpt-5.6-luna-workspace_write", started);
  const qualification = records(path.join(root, ".codex-factory", "qualifications.jsonl")).at(-1);
  assert.equal(qualification.passed, true);

  const deniedConfig = JSON.parse(readFileSync(path.join(root, "factory.config.json"), "utf8"));
  deniedConfig.budgets.aggregatePaidTokens = 1;
  writeFileSync(path.join(root, "factory.config.json"), `${JSON.stringify(deniedConfig)}\n`);
  const before = started.length;
  const denied = qualify(root, markerPath, "analysis");
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /exceeds remaining budget/);
  assert.equal(records(markerPath).length, before, "denied qualification must not spawn");
});

test("paid run-worker reserves before its fake executable and denial prevents spawn", () => {
  const root = isolatedFactory();
  const markerPath = path.join(root, "starts.jsonl");
  const benchmark = qualify(root, markerPath, "benchmark");
  assert.equal(benchmark.status, 0, benchmark.stderr || benchmark.stdout);
  const qualification = qualify(root, markerPath);
  assert.equal(qualification.status, 0, qualification.stderr || qualification.stdout);

  const repository = path.join(root, "owner");
  mkdirSync(repository);
  git(repository, ["init"]);
  git(repository, ["config", "user.name", "Boundary Test"]);
  git(repository, ["config", "user.email", "boundary@example.invalid"]);
  writeFileSync(path.join(repository, "README.md"), "fixture\n");
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "fixture"]);
  const promptPath = path.join(root, "prompt.txt");
  writeFileSync(promptPath, [
    "Acceptance criteria: return a receipt.",
    "Allowed paths: README.md.",
    "Required checks: none.",
    "Do not delegate.",
  ].join("\n"));

  const before = records(markerPath).length;
  const worker = run(process.execPath, [
    path.join(root, "scripts", "run-worker.mjs"),
    "--task-id", "paid-worker-boundary",
    "--role", "standard",
    "--candidate-id", "openai:gpt-5.6-luna",
    "--cwd", repository,
    "--prompt-file", promptPath,
    "--execute",
  ], { cwd: root, env: fakeEnvironment(root, markerPath) });
  assert.equal(worker.status, 0, worker.stderr || worker.stdout);
  assertReservedThenReconciled(
    records(path.join(root, ".codex-factory", "usage.jsonl")),
    "paid-worker-boundary",
    records(markerPath),
  );

  const deniedConfig = JSON.parse(readFileSync(path.join(root, "factory.config.json"), "utf8"));
  deniedConfig.budgets.aggregatePaidTokens = 1;
  const deniedConfigPath = path.join(root, "denied.config.json");
  writeFileSync(deniedConfigPath, `${JSON.stringify(deniedConfig)}\n`);
  const denied = run(process.execPath, [
    path.join(root, "scripts", "run-worker.mjs"),
    "--task-id", "denied-worker-boundary",
    "--role", "standard",
    "--candidate-id", "openai:gpt-5.6-luna",
    "--cwd", repository,
    "--prompt-file", promptPath,
    "--config", deniedConfigPath,
    "--execute",
  ], { cwd: root, env: fakeEnvironment(root, markerPath) });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /exceeds remaining budget/);
  assert.equal(records(markerPath).length, before + 1, "denied admission must not spawn");
});

test("paid OpenAI smoke reserves each fake process and reconciles both invocations", () => {
  const root = isolatedFactory();
  const markerPath = path.join(root, "starts.jsonl");
  const result = run(process.execPath, [
    path.join(root, "scripts", "fleet-smoke.mjs"),
    "--provider", "openai",
    "--model", "gpt-5.6-luna",
    "--execute",
  ], { cwd: root, env: fakeEnvironment(root, markerPath) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const ledger = records(path.join(root, ".codex-factory", "usage.jsonl"));
  const started = records(markerPath);
  assertReservedThenReconciled(ledger, "fleet-smoke-package", started);
  assertReservedThenReconciled(ledger, "fleet-smoke-config", started);

  const deniedConfig = JSON.parse(readFileSync(path.join(root, "factory.config.json"), "utf8"));
  deniedConfig.budgets.aggregatePaidTokens = 1;
  writeFileSync(path.join(root, "factory.config.json"), `${JSON.stringify(deniedConfig)}\n`);
  const denied = run(process.execPath, [
    path.join(root, "scripts", "fleet-smoke.mjs"),
    "--provider", "openai",
    "--model", "gpt-5.6-luna",
    "--execute",
  ], { cwd: root, env: fakeEnvironment(root, markerPath) });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /exceeds remaining budget/);
  assert.equal(records(markerPath).length, started.length, "denied smoke must not spawn");
});

test("local patch crosses fake Ollama and records an accepted bounded commit", async (t) => {
  const root = isolatedFactory();
  const ollama = await startFakeOllama();
  t.after(async () => {
    await stopFakeOllama(ollama.child);
    rmSync(root, { recursive: true, force: true });
  });
  const env = { ...process.env, CODEX_FACTORY_TEST_OLLAMA_URL: ollama.baseUrl };
  for (const role of ["benchmark", "structured_write"]) {
    const qualification = run(process.execPath, [
      path.join(root, "scripts", "qualify-fleet.mjs"),
      "--provider", "ollama",
      "--model", "qwen3.5:14b",
      "--role", role,
      "--execute",
    ], { cwd: root, env });
    assert.equal(qualification.status, 0, qualification.stderr || qualification.stdout);
  }

  const repository = path.join(root, "local-owner");
  mkdirSync(repository);
  git(repository, ["init"]);
  git(repository, ["config", "user.name", "Boundary Test"]);
  git(repository, ["config", "user.email", "boundary@example.invalid"]);
  writeFileSync(path.join(repository, "verify.mjs"), [
    'import { readFileSync } from "node:fs";',
    'if (readFileSync("src/result.txt", "utf8") !== "built by local executable\\n") process.exit(1);',
  ].join("\n"));
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "fixture"]);
  const ownerHead = git(repository, ["rev-parse", "HEAD"]);
  const taskPath = path.join(root, "local-task.json");
  writeFileSync(taskPath, `${JSON.stringify({
    version: 1,
    taskId: `local-boundary-${process.pid}`,
    repository,
    base: ownerHead,
    model: "qwen3.5:14b",
    requiredTier: "standard",
    timeoutMinutes: 1,
    maxOutputTokens: 256,
    maxContextBytes: 16_384,
    instructions: "Create src/result.txt with the exact content required by verify.mjs.",
    readPaths: ["verify.mjs"],
    writePaths: ["src/result.txt"],
    check: { command: process.execPath, args: ["verify.mjs"] },
    commitMessage: "feat: local executable boundary result",
  }, null, 2)}\n`);

  const local = run(process.execPath, [
    path.join(root, "scripts", "run-local-patch.mjs"),
    "--task-file", taskPath,
    "--execute",
  ], { cwd: root, env, timeout: 30_000 });
  assert.equal(local.status, 0, local.stderr || local.stdout);
  const result = JSON.parse(local.stdout);
  assert.equal(result.status, "accepted");
  assert.deepEqual(result.changedPaths, ["src/result.txt"]);
  assert.deepEqual(result.telemetry, {
    promptTokens: 11,
    outputTokens: 7,
    totalTokens: 18,
    totalDurationNs: 1,
  });
  assert.equal(readFileSync(path.join(result.worktreePath, "src", "result.txt"), "utf8"), "built by local executable\n");
  assert.notEqual(result.commit, ownerHead);
  const ledger = records(path.join(root, ".codex-factory", "local-patch", "ledger.jsonl"));
  assert.deepEqual(ledger.map(({ stage, status }) => ({ stage, status })), [
    { stage: "started", status: undefined },
    { stage: "terminal", status: "accepted" },
  ]);
  const slotsPath = path.join(root, ".codex-factory", "slots");
  assert.equal(existsSync(slotsPath) ? readdirSync(slotsPath).length : 0, 0);
  git(repository, ["worktree", "remove", "--force", result.worktreePath]);
  git(repository, ["branch", "-D", result.branch]);
});

test("real supervisor reaps a child and grandchild on timeout before resolving and removes listeners", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-factory-tree-"));
  const pidsPath = path.join(root, "pids.jsonl");
  const sigintListeners = process.listenerCount("SIGINT");
  const sigtermListeners = process.listenerCount("SIGTERM");
  const result = await superviseProcess({
    command: process.execPath,
    args: [path.join(import.meta.dirname, "fixtures", "process-tree-parent.mjs"), pidsPath],
    cwd: root,
    prompt: "",
    timeoutMs: 500,
    reapDeadlineMs: 5_000,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, null, "supervision must observe close before success");
  assert.equal(process.listenerCount("SIGINT"), sigintListeners);
  assert.equal(process.listenerCount("SIGTERM"), sigtermListeners);
  const pids = records(pidsPath);
  assert.deepEqual(pids.map(({ role }) => role).sort(), ["grandchild", "parent"]);
  for (const { pid } of pids) {
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, `pid ${pid} must be dead`);
  }
});

test("campaign default worker subprocess produces and integrates a deterministic Git change", () => {
  const root = isolatedFactory();
  const markerPath = path.join(root, "starts.jsonl");
  const benchmark = qualify(root, markerPath, "benchmark");
  assert.equal(benchmark.status, 0, benchmark.stderr || benchmark.stdout);
  const qualification = qualify(root, markerPath);
  assert.equal(qualification.status, 0, qualification.stderr || qualification.stdout);
  const repository = path.join(root, "campaign-owner");
  mkdirSync(repository);
  git(repository, ["init"]);
  git(repository, ["config", "user.name", "Boundary Test"]);
  git(repository, ["config", "user.email", "boundary@example.invalid"]);
  mkdirSync(path.join(repository, "src"));
  writeFileSync(path.join(repository, "verify.mjs"), [
    'import { readFileSync } from "node:fs";',
    'if (readFileSync("src/result.txt", "utf8") !== "built by executable worker\\n") process.exit(1);',
  ].join("\n"));
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "fixture"]);
  const ownerHead = git(repository, ["rev-parse", "HEAD"]);
  const campaignId = `boundary-${process.pid}-${Date.now()}`;
  const planPath = path.join(root, "campaign.json");
  writeFileSync(planPath, `${JSON.stringify({
    version: 1,
    campaignId,
    repository,
    base: ownerHead,
    maxParallel: 1,
    source: "Create src/result.txt with the exact content required by verify.mjs.",
    tasks: [{
      id: "build-result",
      role: "standard",
      instructions: "Create src/result.txt with the exact required content.",
      readPaths: ["verify.mjs"],
      writePaths: ["src/result.txt"],
      dependsOn: [],
      parallelSafe: false,
      check: { command: process.execPath, args: ["verify.mjs"] },
      commitMessage: "feat: executable boundary result",
    }],
  }, null, 2)}\n`);

  const campaign = run(process.execPath, [
    path.join(root, "scripts", "run-campaign.mjs"),
    "--plan-file", planPath,
    "--execute",
  ], { cwd: root, env: fakeEnvironment(root, markerPath), timeout: 30_000 });
  assert.equal(campaign.status, 0, campaign.stderr || campaign.stdout);
  const result = JSON.parse(campaign.stdout);
  assert.equal(result.status, "completed");
  assert.notEqual(result.commit, ownerHead);
  assert.equal(
    readFileSync(path.join(result.integrationPath, "src", "result.txt"), "utf8").replaceAll("\r\n", "\n"),
    "built by executable worker\n",
  );
  assert.equal(result.tasks[0].result.worker.status, "process_completed");
  assert.equal(git(repository, ["rev-parse", "HEAD"]), ownerHead, "owner branch remains unchanged");
  git(repository, ["worktree", "remove", "--force", result.integrationPath]);
  git(repository, ["branch", "-D", result.integrationBranch]);

  const malformedId = `malformed-${process.pid}-${Date.now()}`;
  const malformedPlan = {
    ...JSON.parse(readFileSync(planPath, "utf8")),
    campaignId: malformedId,
  };
  writeFileSync(planPath, `${JSON.stringify(malformedPlan, null, 2)}\n`);
  const malformed = run(process.execPath, [
    path.join(root, "scripts", "run-campaign.mjs"),
    "--plan-file", planPath,
    "--execute",
  ], {
    cwd: root,
    env: fakeEnvironment(root, markerPath, { CODEX_FACTORY_TEST_FAKE_MODE: "malformed" }),
    timeout: 30_000,
  });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /exhausted local, Luna, and Terra attempts/);
  const campaignsPath = path.join(root, ".codex-factory", "campaigns");
  const malformedRun = readdirSync(campaignsPath).find((name) => name.endsWith(malformedId));
  const failure = JSON.parse(readFileSync(path.join(campaignsPath, malformedRun, "result.json"), "utf8"));
  assert.equal(failure.status, "failed");
  assert.equal(failure.cleanupError, null);
  assert.equal(existsSync(failure.integrationPath), false, "malformed receipt campaign must clean integration worktree");
  assert.match(failure.attempts[0].error, /"status": "failed"/);
  assert.equal(git(repository, ["rev-parse", "HEAD"]), ownerHead);
  rmSync(root, { recursive: true, force: true });
});
