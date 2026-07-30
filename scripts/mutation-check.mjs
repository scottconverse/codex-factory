#!/usr/bin/env node
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runCommand(cwd, args) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

function copyFixture() {
  const fixture = mkdtempSync(path.join(tmpdir(), "codex-factory-mutation-"));
  cpSync(path.join(root, "scripts"), path.join(fixture, "scripts"), {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}.codex-factory${path.sep}`),
  });
  cpSync(path.join(root, "test"), path.join(fixture, "test"), {
    recursive: true,
  });
  cpSync(path.join(root, "factory.config.json"), path.join(fixture, "factory.config.json"));
  return fixture;
}

function replaceExactly(source, before, after, mutantName) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${mutantName}: expected one stable mutation seam, found ${occurrences}`);
  }
  return source.replace(before, after);
}

const mutants = [
  {
    name: "paid-ledger-drops-terminal-usage",
    file: "scripts/factory-admission.mjs",
    command: ["--test", "test/mutation-seams.test.mjs"],
    before: "return [...latestByInvocation.values()].reduce((total, entry) => total + charge(entry), 0);",
    after: "return [...latestByInvocation.values()].reduce((total, entry) => total, 0);",
  },
  {
    name: "paid-admission-lock-is-nonexclusive",
    file: "scripts/factory-slots.mjs",
    command: ["--test", "test/mutation-seams.test.mjs"],
    before: "      return claim(resolved, metadata);",
    after: "      return { path: resolved, release() {} };",
  },
  ...["run-worker.mjs", "qualify-fleet.mjs", "fleet-smoke.mjs"].map((file) => ({
    name: `${file.replace(".mjs", "")}-bypasses-shared-paid-admission`,
    file: `scripts/${file}`,
    command: ["test/fixtures/mutation-paid-launchers.mjs"],
    before: "const admission = await reservePaidUsage({",
    after: "const admission = await Promise.resolve({",
  })),
  {
    name: "process-supervisor-does-not-terminate-real-child",
    file: "scripts/factory-process.mjs",
    command: ["--test", "test/factory-admission.test.mjs"],
    before: "    terminateImpl(child);",
    after: "    void child;",
  },
  {
    name: "process-supervisor-ignores-output-limit",
    file: "scripts/factory-process.mjs",
    command: ["--test", "test/factory-admission.test.mjs"],
    before: "      if (chunk.length <= remaining) {",
    after: "      if (true) {",
  },
  {
    name: "role-policy-ignores-critical-triggers",
    file: "scripts/factory-role-policy.mjs",
    command: ["--test", "test/factory-role-policy.test.mjs"],
    before: '  if (task.accessFamily === "write") {',
    after: "  if (false) {",
  },
  {
    name: "role-enforcement-uses-requested-auto-role",
    file: "scripts/factory-role-classifier.mjs",
    command: ["--test", "test/factory-role-classifier.test.mjs"],
    before: "    ? effectiveRole",
    after: "    ? requestedRole",
  },
  {
    name: "campaign-dispatches-critical-classification",
    file: "scripts/run-campaign.mjs",
    command: ["--test", "test/factory-campaign.test.mjs"],
    before: '    if (receipt.effectiveRole === "critical") {',
    after: "    if (false) {",
  },
  {
    name: "campaign-default-launch-is-skipped",
    file: "scripts/run-campaign.mjs",
    command: ["test/fixtures/mutation-default-campaign.mjs"],
    prepare(fixture) {
      cpSync(
        path.join(fixture, "test", "fixtures", "mutation-worker-cli.mjs"),
        path.join(fixture, "scripts", "run-worker.mjs"),
      );
    },
    before: "      : await runChild(workerCommand, workerArgs, ROOT, activeChildren);",
    after: '      : await Promise.resolve({ status: "process_completed" });',
  },
  {
    name: "campaign-parallel-failure-does-not-wait-for-siblings",
    file: "scripts/factory-campaign.mjs",
    command: ["--test", "test/factory-campaign.test.mjs"],
    before: "const settled = await Promise.allSettled(batch.map((task) => executeTask(task)));",
    after: "const settled = (await Promise.all(batch.map((task) => executeTask(task)))).map((value) => ({ status: \"fulfilled\", value }));",
  },
  {
    name: "campaign-containment-failure-falls-through",
    file: "scripts/factory-campaign.mjs",
    command: ["--test", "test/factory-campaign.test.mjs"],
    before: '      if (error.code !== "WORKER_ATTEMPT_FAILED") throw error;',
    after: '      if (false) throw error;',
  },
  {
    name: "campaign-repository-snapshot-check-is-skipped",
    file: "scripts/run-campaign.mjs",
    command: ["--test", "test/run-campaign.e2e.test.mjs"],
    before: "  assertRepositorySnapshot(repository, plan.base);",
    after: "  void plan.base;",
  },
];

for (const mutant of mutants) {
  const fixture = copyFixture();
  try {
    const filename = path.join(fixture, mutant.file);
    const source = readFileSync(filename, "utf8");
    writeFileSync(filename, replaceExactly(source, mutant.before, mutant.after, mutant.name));
    mutant.prepare?.(fixture);
    const baselineFixture = copyFixture();
    try {
      mutant.prepare?.(baselineFixture);
      const baseline = runCommand(baselineFixture, mutant.command);
      if (baseline.status !== 0) {
        throw new Error(
          `${mutant.name}: mutation baseline failed\n${baseline.stdout}${baseline.stderr}`,
        );
      }
    } finally {
      rmSync(baselineFixture, { recursive: true, force: true });
    }
    const result = runCommand(fixture, mutant.command);
    const output = `${result.stdout}${result.stderr}`;
    if (result.status === 0) {
      throw new Error(`${mutant.name}: survived ${process.execPath} ${mutant.command.join(" ")}\n${output}`);
    }
    if (!/AssertionError/.test(output)) {
      throw new Error(`${mutant.name}: test process failed without a meaningful assertion\n${output}`);
    }
    process.stdout.write(`KILLED ${mutant.name}\n`);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

process.stdout.write(`Mutation score: ${mutants.length}/${mutants.length} known Critical mutants killed\n`);
