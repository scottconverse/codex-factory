import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyFromFiles, parseArgs } from "../scripts/classify-role.mjs";

const config = {
  version: 1,
  classification: {
    mode: "off",
    router: "rules",
    python: ".codex-factory/router-venv/Scripts/python.exe",
    checkpoint: ".codex-factory/router-models/factory-bert-v1",
    thresholdSet: "factory-role-thresholds-v1",
    timeoutSeconds: 20,
    maxInputBytes: 32768,
    maxOutputBytes: 16384,
    reviewThreshold: 0.55,
    criticalEscalationThreshold: 0.9,
    onClassifierFailure: "stop",
    checkExplicitRoles: true,
    allowNetworkDuringInference: false,
  },
};

test("classify-role CLI parses opt-in overrides without execution side effects", () => {
  assert.deepEqual(parseArgs([
    "--task-file", "task.json",
    "--classification-mode", "enforce",
    "--classification-router", "rules",
  ]), {
    taskFile: "task.json",
    classificationMode: "enforce",
    classificationRouter: "rules",
  });
});

test("classify-role writes a rules-only receipt from a bounded task contract", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "classify-role-"));
  const configPath = path.join(root, "config.json");
  const taskPath = path.join(root, "task.json");
  const receiptDirectory = path.join(root, "receipt");
  writeFileSync(configPath, JSON.stringify(config));
  writeFileSync(taskPath, JSON.stringify({
    id: "fix-parser",
    requestedRole: "auto",
    accessFamily: "write",
    taskType: "implementation",
    instructions: "Fix quoted delimiter handling and update its tests.",
    acceptance: ["Quoted delimiters stay in one field."],
    readPaths: ["src/parser.mjs"],
    writePaths: ["src/parser.mjs"],
    checks: ["node --test test/parser.test.mjs"],
    dependencies: 0,
    parallelSafe: false,
  }));
  const result = await classifyFromFiles({
    taskFile: taskPath,
    configFile: configPath,
    receiptDirectory,
    overrides: { mode: "enforce" },
  });
  assert.equal(result.executionRole, "critical");
  assert.equal(result.conservativeAutoWrite, true);
  assert.equal(JSON.parse(readFileSync(path.join(receiptDirectory, "classification.json"), "utf8")).effectiveRole, "critical");
  await assert.rejects(
    classifyFromFiles({
      taskFile: taskPath,
      configFile: configPath,
      receiptDirectory,
      overrides: { mode: "enforce" },
    }),
    /choose a new --receipt-directory/,
  );
});
