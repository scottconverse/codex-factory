import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createCoordinatorIntake } from "../scripts/coordinator-intake.mjs";
import * as campaignRunner from "../scripts/run-campaign.mjs";

function git(repository, args) {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createOwnerRepository(root) {
  const repository = path.join(root, "owner-repository");
  mkdirSync(repository);
  git(repository, ["init"]);
  git(repository, ["config", "user.name", "Campaign E2E"]);
  git(repository, ["config", "user.email", "campaign-e2e@local"]);
  mkdirSync(path.join(repository, "src"));
  writeFileSync(path.join(repository, "src", ".gitkeep"), "");
  writeFileSync(path.join(repository, "verify.mjs"), [
    'import { readFileSync } from "node:fs";',
    'if (readFileSync("src/result.txt", "utf8") !== "built by worker\\n") process.exit(1);',
    "",
  ].join("\n"));
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "owner baseline"]);
  return repository;
}

function coordinatorPlan(intake, source, overrides = {}) {
  const plan = {
    version: 1,
    campaignId: intake.campaignId,
    repository: intake.repository,
    base: intake.base,
    maxParallel: 1,
    source,
    tasks: [{
      id: "build-result",
      role: "standard",
      instructions: "Create the requested result file with the exact required content.",
      readPaths: ["verify.mjs"],
      writePaths: ["src/result.txt"],
      dependsOn: [],
      parallelSafe: false,
      check: { command: process.execPath, args: ["verify.mjs"] },
      commitMessage: "feat: build requested result",
    }],
    ...overrides,
  };
  writeFileSync(intake.planFile, `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

function injectedAttempts() {
  return [{
    id: "injected:test-worker",
    provider: "injected",
    model: "process-boundary-fixture",
    runner: "codex-worker",
  }];
}

test("owner prompt reaches a real campaign integration commit while the owner branch stays unchanged", async (t) => {
  assert.equal(typeof campaignRunner.runCampaign, "function", "run-campaign must expose an injectable real orchestration seam");
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-factory-campaign-e2e-"));
  const repository = createOwnerRepository(root);
  const stateRoot = path.join(root, "factory-state");
  const ownerHead = git(repository, ["rev-parse", "HEAD"]);
  const ownerBranch = git(repository, ["branch", "--show-current"]);
  const prompt = "Build src/result.txt containing the exact text required by verify.mjs.";
  const intake = createCoordinatorIntake({
    repository,
    prompt,
    campaignId: `e2e-${process.pid}-${Date.now()}`,
  });
  coordinatorPlan(intake, readFileSync(intake.sourcePath, "utf8"));

  const result = await campaignRunner.runCampaign({
    planFile: intake.planFile,
    execute: true,
    stateRoot,
    resolveAttempts: injectedAttempts,
    launchWorker: async ({ worktreePath }) => {
      writeFileSync(path.join(worktreePath, "src", "result.txt"), "built by worker\n");
      return { status: "process_completed", exitCode: 0, finalMessage: "fixture completed" };
    },
  });
  t.after(() => {
    git(repository, ["worktree", "remove", "--force", result.integrationPath]);
    git(repository, ["branch", "-D", result.integrationBranch]);
  });

  assert.equal(result.status, "completed");
  assert.notEqual(result.commit, ownerHead);
  assert.equal(readFileSync(path.join(result.integrationPath, "src", "result.txt"), "utf8").replaceAll("\r\n", "\n"), "built by worker\n");
  assert.equal(result.tasks[0].result.check.exitCode, 0);
  assert.equal(result.tasks[0].result.changedPaths.join(","), "src/result.txt");
  assert.equal(existsSync(result.tasks[0].result.worktreePath), false);
  assert.equal(git(repository, ["branch", "--list", result.tasks[0].result.branch]), "");
  assert.equal(existsSync(path.join(result.runPath, "request.json")), true);
  assert.equal(existsSync(path.join(result.runPath, "result.json")), true);
  assert.match(readFileSync(path.join(result.runPath, "cleanup.jsonl"), "utf8"), /"kind":"accepted-worker"/);
  assert.equal(git(repository, ["branch", "--show-current"]), ownerBranch);
  assert.equal(git(repository, ["rev-parse", "HEAD"]), ownerHead);
  assert.equal(existsSync(path.join(repository, "src", "result.txt")), false);
  assert.equal(git(repository, ["status", "--short"]), "");
});

test("a failed real campaign removes worker and integration worktrees and records cleanup receipts", async () => {
  assert.equal(typeof campaignRunner.runCampaign, "function", "run-campaign must expose an injectable real orchestration seam");
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-factory-campaign-fail-"));
  const repository = createOwnerRepository(root);
  const stateRoot = path.join(root, "factory-state");
  const ownerHead = git(repository, ["rev-parse", "HEAD"]);
  const intake = createCoordinatorIntake({
    repository,
    prompt: "Build the exact checked result and preserve the owner branch if the task fails.",
    campaignId: `fail-${process.pid}-${Date.now()}`,
  });
  coordinatorPlan(intake, readFileSync(intake.sourcePath, "utf8"));

  await assert.rejects(() => campaignRunner.runCampaign({
    planFile: intake.planFile,
    execute: true,
    stateRoot,
    resolveAttempts: injectedAttempts,
    launchWorker: async ({ worktreePath }) => {
      writeFileSync(path.join(worktreePath, "src", "result.txt"), "wrong content\n");
      return { status: "process_completed", exitCode: 0, finalMessage: "fixture completed" };
    },
  }), /exhausted local, Luna, and Terra attempts/);

  const runPath = path.join(stateRoot, ".codex-factory", "campaigns", readdirSync(path.join(stateRoot, ".codex-factory", "campaigns"))[0]);
  const failure = JSON.parse(readFileSync(path.join(runPath, "result.json"), "utf8"));
  const cleanup = readFileSync(path.join(runPath, "cleanup.jsonl"), "utf8");
  const cleanupReceipts = cleanup.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(failure.status, "failed");
  assert.equal(failure.cleanupError, null);
  assert.match(cleanup, /"kind":"failed-worker"/);
  assert.match(cleanup, /"kind":"integration"/);
  assert.equal(cleanupReceipts.every((receipt) => receipt.cleanupError === null), true);
  assert.equal(cleanupReceipts.every((receipt) => !existsSync(receipt.worktreePath)), true);
  assert.equal(cleanupReceipts.every((receipt) => git(repository, ["branch", "--list", receipt.branch]) === ""), true);
  assert.equal(existsSync(failure.integrationPath), false);
  assert.equal(git(repository, ["branch", "--list", failure.integrationBranch]), "");
  assert.equal(git(repository, ["rev-parse", "HEAD"]), ownerHead);
  assert.equal(git(repository, ["status", "--short"]), "");
});

test("campaign preview fails closed when a task has no qualified attempts", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-factory-campaign-preview-"));
  const repository = createOwnerRepository(root);
  const intake = createCoordinatorIntake({
    repository,
    prompt: "Build the requested result only after a qualified route is available.",
    campaignId: `preview-${process.pid}-${Date.now()}`,
  });
  coordinatorPlan(intake, readFileSync(intake.sourcePath, "utf8"));

  await assert.rejects(() => campaignRunner.runCampaign({
    planFile: intake.planFile,
    resolveAttempts: () => [],
  }), (error) => {
    assert.match(error.message, /build-result/);
    assert.match(error.message, /standard/);
    assert.match(error.message, /npm\.cmd run fleet:qualify/);
    assert.match(error.message, /preview/i);
    return true;
  });
});
