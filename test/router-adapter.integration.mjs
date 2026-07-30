import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyFactoryRole } from "../scripts/factory-role-classifier.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PYTHON = process.env.CODEX_FACTORY_ROUTER_PYTHON;

test("Node classification crosses the real Python adapter and tiny checkpoint", async () => {
  assert.ok(PYTHON, "CODEX_FACTORY_ROUTER_PYTHON must name the prepared router Python");
  const scratch = mkdtempSync(path.join(os.tmpdir(), "factory-router-integration-"));
  try {
    const built = spawnSync(PYTHON, [
      path.join(ROOT, "python", "tests", "build_router_fixture.py"),
      "--root",
      scratch,
    ], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        HF_DATASETS_OFFLINE: "1",
      },
      timeout: 60_000,
      windowsHide: true,
    });
    assert.equal(built.status, 0, built.stderr || built.stdout);
    const fixture = JSON.parse(built.stdout);
    const receiptDirectory = path.join(scratch, "receipt");
    const receipt = await classifyFactoryRole({
      task: {
        id: "adapter-integration",
        requestedRole: "auto",
        accessFamily: "write",
        taskType: "implementation",
        instructions: "Change parser delimiter behavior and update its tests.",
        readPaths: ["src/parser.mjs"],
        writePaths: ["src/parser.mjs"],
        acceptance: ["Quoted delimiters remain in one field."],
        checks: ["node --test test/parser.test.mjs"],
        dependencies: 0,
        parallelSafe: false,
      },
      classification: {
        mode: "enforce",
        router: "factory_bert",
        python: PYTHON,
        checkpoint: fixture.checkpoint,
        checkpointFingerprint: fixture.checkpointFingerprint,
        thresholdSet: "factory-role-thresholds-v1",
        thresholdFingerprint: fixture.thresholdFingerprint,
        timeoutSeconds: 30,
        maxInputBytes: 32_768,
        maxOutputBytes: 16_384,
        reviewThreshold: 0.55,
        criticalEscalationThreshold: 0.9,
        onClassifierFailure: "stop",
        checkExplicitRoles: true,
        allowNetworkDuringInference: false,
      },
      receiptDirectory,
    });

    assert.equal(receipt.classificationAvailable, true);
    assert.equal(receipt.executionRole, "critical");
    assert.ok(receipt.routeLLM.difficultyScore > 0.8);
    assert.equal(receipt.routeLLM.checkpointFingerprint, fixture.checkpointFingerprint);
    assert.equal(receipt.routeLLM.thresholdFingerprint, fixture.thresholdFingerprint);
    assert.equal(receipt.classifierEvidence.stderr, "");
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(receiptDirectory, "classification.json"), "utf8")),
      receipt,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
