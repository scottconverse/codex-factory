import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runCampaign } from "../../scripts/run-campaign.mjs";

function git(repository, args) {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "factory-default-launch-mutation-"));
const repository = path.join(temporaryRoot, "repository");
mkdirSync(path.join(repository, "src"), { recursive: true });
git(repository, ["init"]);
git(repository, ["config", "user.name", "Mutation Fixture"]);
git(repository, ["config", "user.email", "mutation@example.invalid"]);
writeFileSync(path.join(repository, "src", ".gitkeep"), "");
writeFileSync(
  path.join(repository, "verify.mjs"),
  'import { readFileSync } from "node:fs";\nassert(readFileSync("src/result.txt", "utf8") === "built by default launcher\\n");\nfunction assert(value) { if (!value) process.exit(1); }\n',
);
git(repository, ["add", "."]);
git(repository, ["commit", "-m", "fixture baseline"]);
const base = git(repository, ["rev-parse", "HEAD"]);
const planFile = path.join(temporaryRoot, "plan.json");
writeFileSync(planFile, `${JSON.stringify({
  version: 1,
  campaignId: `mutation-${process.pid}`,
  repository,
  base,
  maxParallel: 1,
  source: "Create the exact file required by verify.mjs.",
  tasks: [{
    id: "default-launch",
    role: "standard",
    instructions: "Create src/result.txt with the required content.",
    readPaths: ["verify.mjs"],
    writePaths: ["src/result.txt"],
    dependsOn: [],
    parallelSafe: false,
    check: { command: process.execPath, args: ["verify.mjs"] },
    commitMessage: "test: exercise default worker launch",
  }],
}, null, 2)}\n`);

let result;
try {
  await assert.doesNotReject(async () => {
    result = await runCampaign({
      planFile,
      execute: true,
      stateRoot: temporaryRoot,
      resolveAttempts: () => [{
        id: "fixture:default-launch",
        provider: "fixture",
        model: "default-launch",
        runner: "codex-worker",
      }],
    });
  });
  assert.equal(result.status, "completed");
  assert.equal(result.tasks[0].result.worker.status, "process_completed");
} finally {
  if (result?.integrationPath) {
    git(repository, ["worktree", "remove", "--force", result.integrationPath]);
    git(repository, ["branch", "-D", result.integrationBranch]);
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}
