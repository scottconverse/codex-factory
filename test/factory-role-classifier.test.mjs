import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyFactoryRole,
  encodeFactoryTask,
  validateClassificationConfig,
  validateRouterResponse,
} from "../scripts/factory-role-classifier.mjs";

const task = (overrides = {}) => ({
  id: "fix-parser",
  requestedRole: "auto",
  accessFamily: "write",
  taskType: "implementation",
  instructions: "Fix quoted delimiter handling and update its tests.",
  readPaths: ["src/parser.mjs", "test/parser.test.mjs"],
  writePaths: ["src/parser.mjs", "test/parser.test.mjs"],
  acceptance: ["Quoted delimiters remain inside one field."],
  checks: ["node --test test/parser.test.mjs"],
  dependencies: 0,
  parallelSafe: false,
  ...overrides,
});

const classification = (overrides = {}) => ({
  mode: "shadow",
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
  ...overrides,
});

test("classification config is strict and ships only local, fail-closed inference", () => {
  assert.equal(validateClassificationConfig(classification()).mode, "shadow");
  assert.throws(() => validateClassificationConfig(classification({ allowNetworkDuringInference: true })), /network/i);
  assert.throws(() => validateClassificationConfig(classification({ onClassifierFailure: "continue" })), /failure/i);
  assert.throws(() => validateClassificationConfig(classification({ reviewThreshold: 0.95 })), /threshold/i);
  assert.throws(() => validateClassificationConfig(classification({ maxInputBytes: 32_769 })), /input bytes/i);
});

test("task encoding is stable, bounded, and redacts machine paths, URLs, and credential-shaped values", () => {
  const encoded = encodeFactoryTask(task({
    instructions: "Inspect C:\\Users\\scott\\repo and https://private.example/x with API_KEY=topsecret.",
    readPaths: ["test/parser.test.mjs", "src/parser.mjs"],
  }), { maxInputBytes: 32768 });
  assert.match(encoded.text, /^\[FACTORY_TASK_V1\]/);
  assert.doesNotMatch(encoded.text, /scott|private\.example|topsecret/i);
  assert.match(encoded.text, /\[ABSOLUTE_PATH\]|\[URL\]|\[REDACTED\]/);
  assert.match(encoded.hash, /^sha256:[a-f0-9]{64}$/);
  const reordered = encodeFactoryTask(task({
    instructions: "Inspect C:\\Users\\scott\\repo and https://private.example/x with API_KEY=topsecret.",
    readPaths: ["src/parser.mjs", "test/parser.test.mjs"],
  }), { maxInputBytes: 32768 });
  assert.equal(encoded.hash, reordered.hash);
  assert.throws(() => encodeFactoryTask(task({ instructions: "x".repeat(2_000) }), { maxInputBytes: 1000 }), /input.*bytes/i);
});

test("task encoding matches the cross-language golden fixture", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const fixture = JSON.parse(readFileSync(path.join(root, "test", "fixtures", "classification-task.json"), "utf8"));
  const expected = `${readFileSync(path.join(root, "test", "fixtures", "classification-task.txt"), "utf8").trimEnd()}\n`;
  assert.equal(encodeFactoryTask(fixture, { maxInputBytes: 32768 }).text, expected);
});

test("rules shadow preserves an explicit route and records the proposed escalation", async () => {
  const result = await classifyFactoryRole({
    task: task({
      requestedRole: "standard",
      instructions: "Change session-token rotation and update its tests.",
      writePaths: ["src/auth/session.mjs"],
    }),
    classification: classification(),
  });
  assert.equal(result.effectiveRole, "critical");
  assert.equal(result.executionRole, "standard");
  assert.equal(result.previewOnly, false);
  assert.ok(result.riskTriggers.includes("AUTH_OR_SECRETS"));
});

test("auto shadow is preview-only while auto enforce uses the classified role", async () => {
  const shadow = await classifyFactoryRole({ task: task(), classification: classification() });
  assert.equal(shadow.effectiveRole, "critical");
  assert.equal(shadow.executionRole, null);
  assert.equal(shadow.previewOnly, true);

  const enforce = await classifyFactoryRole({
    task: task(),
    classification: classification({ mode: "enforce" }),
  });
  assert.equal(enforce.executionRole, "critical");
  assert.equal(enforce.previewOnly, false);
});

test("learned score escalates read and write tasks without lowering an explicit floor", async () => {
  const response = (score) => ({
    schemaVersion: 1,
    taskId: "fix-parser",
    router: "factory_bert",
    difficultyScore: score,
    scoreMeaning: "probability_stronger_lane_required",
    checkpointFingerprint: `sha256:${"a".repeat(64)}`,
    thresholdSet: "factory-role-thresholds-v1",
    thresholdFingerprint: `sha256:${"c".repeat(64)}`,
    reviewThreshold: 0.55,
    criticalEscalationThreshold: 0.9,
    criticalFalseNegatives: 0,
    routeLLMRevision: "0b64fdafe049e596a3f5657c219329f24af24198",
    durationMs: 7,
  });
  const learned = classification({
    mode: "enforce",
    router: "factory_bert",
    checkpointFingerprint: `sha256:${"a".repeat(64)}`,
    thresholdFingerprint: `sha256:${"c".repeat(64)}`,
  });
  const write = await classifyFactoryRole({
    task: task(),
    classification: learned,
    scoreTask: async () => response(0.91),
  });
  assert.equal(write.executionRole, "critical");

  const read = await classifyFactoryRole({
    task: task({
      requestedRole: "review",
      accessFamily: "read",
      taskType: "review",
      instructions: "Review parser error handling and report correctness risks.",
      writePaths: [],
    }),
    classification: learned,
    scoreTask: async () => response(0.1),
  });
  assert.equal(read.executionRole, "review");
});

test("validated router responses bind task, schema, revision, checkpoint, and threshold set", () => {
  const expected = classification({
    mode: "enforce",
    router: "factory_bert",
    checkpointFingerprint: `sha256:${"a".repeat(64)}`,
    thresholdFingerprint: `sha256:${"c".repeat(64)}`,
  });
  const response = {
    schemaVersion: 1,
    taskId: "fix-parser",
    router: "factory_bert",
    difficultyScore: 0.72,
    scoreMeaning: "probability_stronger_lane_required",
    checkpointFingerprint: expected.checkpointFingerprint,
    thresholdSet: expected.thresholdSet,
    thresholdFingerprint: expected.thresholdFingerprint,
    reviewThreshold: expected.reviewThreshold,
    criticalEscalationThreshold: expected.criticalEscalationThreshold,
    criticalFalseNegatives: 0,
    routeLLMRevision: "0b64fdafe049e596a3f5657c219329f24af24198",
    durationMs: 12,
  };
  assert.equal(validateRouterResponse(response, { taskId: "fix-parser", classification: expected }).difficultyScore, 0.72);
  for (const mutation of [
    { schemaVersion: 2 },
    { taskId: "other" },
    { difficultyScore: Number.NaN },
    { checkpointFingerprint: `sha256:${"b".repeat(64)}` },
    { thresholdSet: "other" },
    { thresholdFingerprint: `sha256:${"d".repeat(64)}` },
    { reviewThreshold: 0.5 },
    { criticalFalseNegatives: 1 },
    { routeLLMRevision: "deadbeef" },
  ]) {
    assert.throws(
      () => validateRouterResponse({ ...response, ...mutation }, { taskId: "fix-parser", classification: expected }),
      /router response/i,
    );
  }
});

test("classification receipt is written before routing and contains reproducibility evidence", async () => {
  const receiptDirectory = mkdtempSync(path.join(tmpdir(), "factory-classification-"));
  const result = await classifyFactoryRole({
    task: task(),
    classification: classification({ mode: "enforce" }),
    receiptDirectory,
  });
  const receipt = JSON.parse(readFileSync(path.join(receiptDirectory, "classification.json"), "utf8"));
  assert.equal(receipt.effectiveRole, result.effectiveRole);
  assert.equal(receipt.requestedRole, "auto");
  assert.match(receipt.encodedTaskHash, /^sha256:/);
  assert.equal(receipt.policyVersion, "3");
  assert.equal(receipt.encoderVersion, "1");
});

test("learned classifier failures are receipted before fail-closed enforcement", async () => {
  const receiptDirectory = mkdtempSync(path.join(tmpdir(), "factory-classification-failure-"));
  const learned = classification({
    mode: "enforce",
    router: "factory_bert",
    checkpointFingerprint: `sha256:${"a".repeat(64)}`,
    thresholdFingerprint: `sha256:${"c".repeat(64)}`,
  });
  await assert.rejects(
    classifyFactoryRole({
      task: task(),
      classification: learned,
      scoreTask: async () => {
        throw new Error("checkpoint unavailable");
      },
      receiptDirectory,
    }),
    /checkpoint unavailable/,
  );
  const receipt = JSON.parse(readFileSync(path.join(receiptDirectory, "classification.json"), "utf8"));
  assert.equal(receipt.classificationAvailable, false);
  assert.equal(receipt.classificationError, "checkpoint unavailable");
  assert.equal(receipt.executionRole, null);
  assert.equal(receipt.effectiveRole, "critical");
  assert.match(receipt.encodedTaskHash, /^sha256:/);
});

test("off rejects auto and does not invoke classification", async () => {
  await assert.rejects(
    classifyFactoryRole({ task: task(), classification: classification({ mode: "off" }) }),
    /auto.*shadow or enforce/i,
  );
  const explicit = await classifyFactoryRole({
    task: task({ requestedRole: "standard" }),
    classification: classification({ mode: "off" }),
  });
  assert.equal(explicit.executionRole, "standard");
  assert.equal(explicit.classificationAvailable, false);
});

test("checkExplicitRoles false leaves explicit workflows unclassified", async () => {
  const explicit = await classifyFactoryRole({
    task: { requestedRole: "standard" },
    classification: classification({ mode: "enforce", checkExplicitRoles: false }),
  });
  assert.equal(explicit.effectiveRole, "standard");
  assert.equal(explicit.executionRole, "standard");
  assert.equal(explicit.classificationAvailable, false);
});
