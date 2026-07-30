import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { summarizeLedger } from "../scripts/factory-admission.mjs";
import { candidateFingerprint, discoverCandidatePool, parseOllamaDiscovery, selectCandidate } from "../scripts/factory-fleet.mjs";
import { prepareDeclaredWritePath, superviseProcess } from "../scripts/factory-process.mjs";
import { acquireWorkerSlot } from "../scripts/factory-slots.mjs";
import { runCampaign } from "../scripts/run-campaign.mjs";

function git(repository, args) {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function repositoryFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "factory-engineering-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repo");
  mkdirSync(repository);
  git(repository, ["init"]);
  git(repository, ["config", "user.name", "Engineering Regression"]);
  git(repository, ["config", "user.email", "engineering@example.invalid"]);
  writeFileSync(path.join(repository, "README.md"), "fixture\n");
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "base"]);
  return { root, repository, base: git(repository, ["rev-parse", "HEAD"]) };
}

function campaignPlan(fixture, writePaths, check) {
  const planFile = path.join(fixture.root, "plan.json");
  writeFileSync(planFile, `${JSON.stringify({
    version: 1,
    campaignId: `engineering-${process.pid}-${Date.now()}`,
    repository: fixture.repository,
    base: fixture.base,
    maxParallel: 1,
    source: "Create the requested bounded artifact.",
    tasks: [{
      id: "nested-write",
      role: "standard",
      instructions: "Create the requested artifact.",
      readPaths: ["README.md"],
      writePaths,
      dependsOn: [],
      parallelSafe: false,
      check,
      commitMessage: "feat: nested artifact",
    }],
  }, null, 2)}\n`);
  return planFile;
}

const injectedAttempts = () => [{
  id: "injected:test-worker",
  provider: "injected",
  model: "fixture",
  runner: "codex-worker",
}];

test("campaign accepts a declared write whose nested parents do not yet exist", async (t) => {
  const fixture = repositoryFixture(t);
  const result = await runCampaign({
    planFile: campaignPlan(fixture, ["new/deep/result.txt"], { command: process.execPath, args: ["-e", "process.exit(0)"] }),
    execute: true,
    stateRoot: fixture.root,
    resolveAttempts: injectedAttempts,
    launchWorker: async ({ worktreePath }) => {
      mkdirSync(path.join(worktreePath, "new", "deep"), { recursive: true });
      writeFileSync(path.join(worktreePath, "new", "deep", "result.txt"), "ok\n");
      return { status: "process_completed", exitCode: 0, finalMessage: "done" };
    },
  });
  assert.equal(result.status, "completed");
  git(fixture.repository, ["worktree", "remove", "--force", result.integrationPath]);
  git(fixture.repository, ["branch", "-D", result.integrationBranch]);
});

test("campaign rejects an out-of-scope file created by its required check", async (t) => {
  const fixture = repositoryFixture(t);
  await assert.rejects(() => runCampaign({
    planFile: campaignPlan(fixture, ["result.txt"], {
      command: process.execPath,
      args: ["-e", 'require("node:fs").writeFileSync("outside.txt","bad")'],
    }),
    execute: true,
    stateRoot: fixture.root,
    resolveAttempts: injectedAttempts,
    launchWorker: async ({ worktreePath }) => {
      writeFileSync(path.join(worktreePath, "result.txt"), "ok\n");
      return { status: "process_completed", exitCode: 0, finalMessage: "done" };
    },
  }), (error) => {
    assert.match(error.attempts?.[0]?.error ?? "", /outside the task contract.*outside\.txt/i);
    return true;
  });
});

test("Ollama immutable digest participates in current qualification identity", () => {
  const parsed = parseOllamaDiscovery(
    { version: "1.0.0" },
    { models: [{ name: "same:tag", digest: "sha256:one", capabilities: ["completion"] }] },
  );
  assert.equal(parsed.models[0].digest, "sha256:one");
  const oldCandidate = discoverCandidatePool({ config: { candidates: { openai: [] } }, ollama: parsed })[0];
  const currentCandidate = discoverCandidatePool({
    config: { candidates: { openai: [] } },
    ollama: { ...parsed, models: [{ ...parsed.models[0], digest: "sha256:two" }] },
  })[0];
  assert.notEqual(candidateFingerprint(oldCandidate, "analysis"), candidateFingerprint(currentCandidate, "analysis"));
  assert.throws(() => selectCandidate({
    candidates: [currentCandidate],
    qualifications: [{
      candidateId: oldCandidate.id,
      role: "analysis",
      fingerprint: candidateFingerprint(oldCandidate, "analysis"),
      passed: true,
    }],
    role: "analysis",
  }), /No currently qualified candidate/);
  const legacy = { ...currentCandidate };
  delete legacy.digest;
  assert.notEqual(candidateFingerprint(legacy, "analysis"), candidateFingerprint(currentCandidate, "analysis"));
});

test("ambiguous extra legacy terminal fails closed with task and line context", () => {
  const ledger = [
    '{"taskId":"legacy","paid":true,"usage":{"total_tokens":10}}',
    '{"taskId":"legacy","paid":true,"usage":{"total_tokens":20}}',
  ].join("\n");
  assert.throws(
    () => summarizeLedger(ledger, true),
    /legacy.*line 2.*ambiguous|ambiguous.*legacy.*line 2/i,
  );
});

test("unreaped process errors identify the exact child and process group", async () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  await assert.rejects(superviseProcess({
    command: "fake",
    args: [],
    cwd: ".",
    prompt: "",
    timeoutMs: 1,
    reapDeadlineMs: 2,
    spawnImpl: () => child,
    terminateImpl: () => {},
    signalSource: new EventEmitter(),
  }), (error) => error.code === "PROCESS_NOT_REAPED"
    && error.childPid === 4321
    && error.processGroup !== undefined);
});

test("linked components in a declared nested write path are rejected", (t) => {
  const fixture = repositoryFixture(t);
  const outside = path.join(fixture.root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, path.join(fixture.repository, "linked"), "junction");
  assert.throws(
    () => prepareDeclaredWritePath(fixture.repository, "linked/deep/result.txt"),
    /linked parent|symbolic link/i,
  );
});

test("nonpaid task reservation is atomic across OS processes under usage.lock", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "factory-unpaid-reservation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const moduleUrl = new URL("../scripts/factory-admission.mjs", import.meta.url).href;
  const source = `import { reserveUnpaidTaskUsage } from ${JSON.stringify(moduleUrl)};
await reserveUnpaidTaskUsage({ stateRoot: process.argv[1], taskId: "same-task" });`;
  const children = [1, 2].map(() => new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, root], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("close", (status) => resolve({
      status,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  }));
  const results = await Promise.all(children);
  assert.deepEqual(results.map((result) => result.status).sort(), [0, 1]);
  assert.match(results.find((result) => result.status === 1).stderr, /already has an attempt/);
  assert.equal(readFileSync(path.join(root, "usage.jsonl"), "utf8").trim().split(/\r?\n/).length, 1);
});

test("quarantined slots reclaim only after their exact child is gone", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "factory-quarantine-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const slotRoot = path.join(root, "worker-slots");
  mkdirSync(slotRoot);
  const lockPath = path.join(slotRoot, "1.lock");
  writeFileSync(lockPath, `${JSON.stringify({
    pid: process.pid,
    quarantined: true,
    childPid: 2_147_483_647,
  })}\n`);
  const reclaimed = acquireWorkerSlot(root, 1, { taskId: "replacement" });
  reclaimed.release();

  writeFileSync(lockPath, `${JSON.stringify({
    pid: 2_147_483_647,
    quarantined: true,
    childPid: process.pid,
  })}\n`);
  assert.throws(() => acquireWorkerSlot(root, 1, { taskId: "blocked" }), /occupied/);
});
