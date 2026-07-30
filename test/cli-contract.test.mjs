import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const COMMANDS = [
  {
    script: "coordinator-intake.mjs",
    helpFlags: ["--prompt-file", "--prompt", "--repository", "--bootstrap", "--campaign-id", "--base"],
    valueFlag: "--prompt",
    booleanFlag: "--help",
  },
  {
    script: "run-worker.mjs",
    helpFlags: ["--task-id", "--role", "--cwd", "--prompt-file", "--candidate-id", "--timeout-minutes", "--config", "--execute"],
    valueFlag: "--task-id",
    booleanFlag: "--execute",
  },
  {
    script: "run-local-patch.mjs",
    helpFlags: ["--task-file", "--execute"],
    valueFlag: "--task-file",
    booleanFlag: "--execute",
  },
  {
    script: "run-campaign.mjs",
    helpFlags: ["--plan-file", "--execute"],
    valueFlag: "--plan-file",
    booleanFlag: "--execute",
  },
  {
    script: "qualify-fleet.mjs",
    helpFlags: ["--provider", "--model", "--role", "--include-paid", "--execute"],
    valueFlag: "--provider",
    booleanFlag: "--include-paid",
  },
  {
    script: "fleet-smoke.mjs",
    helpFlags: ["--provider", "--model", "--reasoning-effort", "--timeout-minutes", "--execute"],
    valueFlag: "--provider",
    booleanFlag: "--execute",
  },
];

function run(script, args) {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
}

test("every operator CLI exposes quiet, complete help through -h and --help", () => {
  for (const command of COMMANDS) {
    for (const helpFlag of ["-h", "--help"]) {
      const result = run(command.script, [helpFlag]);
      assert.equal(result.status, 0, `${command.script} ${helpFlag}: ${result.stderr}`);
      assert.equal(result.stderr, "", `${command.script} ${helpFlag} wrote stderr`);
      assert.match(result.stdout, /^Usage:/, `${command.script} ${helpFlag} omitted usage`);
      for (const flag of command.helpFlags) {
        assert.match(result.stdout, new RegExp(flag.replaceAll("-", "\\-")), `${command.script} help omitted ${flag}`);
      }
    }
  }
});

test("every operator CLI rejects malformed argv with one actionable error contract", () => {
  for (const command of COMMANDS) {
    const cases = [
      ["--unknown"],
      ["stray"],
      [command.valueFlag],
      [command.valueFlag, "one", command.valueFlag, "two"],
      [command.booleanFlag, command.booleanFlag],
    ];
    for (const args of cases) {
      const result = run(command.script, args);
      assert.equal(result.status, 1, `${command.script} ${args.join(" ")} unexpectedly exited ${result.status}`);
      assert.equal(result.stdout, "", `${command.script} ${args.join(" ")} polluted stdout`);
      assert.match(result.stderr, /^Error: .+\r?\nRun with --help for usage\.\r?\n$/, `${command.script} ${args.join(" ")} emitted: ${JSON.stringify(result.stderr)}`);
    }
  }
});

test("run-worker rejects a misspelled timeout flag instead of using its default", () => {
  const result = run("run-worker.mjs", ["--timeout-minute", "2"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^Error: Unknown option: --timeout-minute\r?\nRun with --help for usage\.\r?\n$/);
});
