import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { superviseProcess } from "./factory-process.mjs";
import {
  classifyDeterministicPolicy,
  combineRoleDecision,
  normalizeClassificationTask,
} from "./factory-role-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTELLM_REVISION = "0b64fdafe049e596a3f5657c219329f24af24198";
const MODES = new Set(["off", "shadow", "enforce"]);
const ROUTERS = new Set(["rules", "factory_bert"]);
const FAILURE_POLICIES = new Set(["stop", "use-explicit"]);
const ROLE_FAMILY = Object.freeze({
  "local-read": "read",
  mechanical: "read",
  review: "read",
  standard: "write",
  critical: "write",
});
const RESPONSE_FIELDS = new Set([
  "schemaVersion",
  "taskId",
  "router",
  "difficultyScore",
  "scoreMeaning",
  "checkpointFingerprint",
  "thresholdSet",
  "thresholdFingerprint",
  "reviewThreshold",
  "criticalEscalationThreshold",
  "criticalFalseNegatives",
  "routeLLMRevision",
  "durationMs",
]);

export const ENCODER_VERSION = "1";

function validateInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
}

function validateProbability(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite number from 0 through 1`);
  }
}

export function validateClassificationConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Classification configuration is required");
  if (!MODES.has(value.mode)) throw new Error("Classification mode must be off, shadow, or enforce");
  if (!ROUTERS.has(value.router)) throw new Error("Classification router must be rules or factory_bert");
  if (typeof value.python !== "string" || !value.python || /[\r\n\0]/.test(value.python)) throw new Error("Classification Python path is invalid");
  if (typeof value.checkpoint !== "string" || !value.checkpoint || /[\r\n\0]/.test(value.checkpoint)) throw new Error("Classification checkpoint path is invalid");
  if (!/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(value.thresholdSet ?? "")) throw new Error("Classification threshold set is invalid");
  validateInteger(value.timeoutSeconds, "Classification timeout", 1, 300);
  validateInteger(value.maxInputBytes, "Classification max input bytes", 1024, 32_768);
  validateInteger(value.maxOutputBytes, "Classification max output bytes", 1024, 1_048_576);
  validateProbability(value.reviewThreshold, "Classification review threshold");
  validateProbability(value.criticalEscalationThreshold, "Classification critical escalation threshold");
  if (value.reviewThreshold > value.criticalEscalationThreshold) throw new Error("Classification review threshold must not exceed critical threshold");
  if (!FAILURE_POLICIES.has(value.onClassifierFailure)) throw new Error("Classification failure policy must be stop or use-explicit");
  if (typeof value.checkExplicitRoles !== "boolean") throw new Error("Classification checkExplicitRoles must be boolean");
  if (value.allowNetworkDuringInference !== false) throw new Error("Classification network access must remain disabled");
  if (value.router === "factory_bert" && !/^sha256:[a-f0-9]{64}$/.test(value.checkpointFingerprint ?? "")) {
    throw new Error("Factory BERT classification requires a pinned checkpoint fingerprint");
  }
  if (value.router === "factory_bert" && !/^sha256:[a-f0-9]{64}$/.test(value.thresholdFingerprint ?? "")) {
    throw new Error("Factory BERT classification requires a pinned threshold fingerprint");
  }
  return value;
}

function redact(value) {
  return value
    .replace(/\b(?:https?|ssh|git):\/\/[^\s<>"']+/gi, "[URL]")
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, "[ABSOLUTE_PATH]")
    .replace(/(?:^|[\s;])((?:api[_-]?key|access[_-]?token|password|secret|credential)\s*[=:]\s*)[^\s;]+/gim, (match, prefix) =>
      `${match.startsWith(" ") || match.startsWith(";") ? match[0] : ""}${prefix}[REDACTED]`);
}

function boundedList(value, label, limit = 256) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a bounded string array`);
  }
  return [...value];
}

export function encodeFactoryTask(value, { maxInputBytes }) {
  validateInteger(maxInputBytes, "Classification max input bytes", 1, 32_768);
  const task = normalizeClassificationTask(value);
  const acceptance = boundedList(value.acceptance, "Classification acceptance");
  const checks = boundedList(value.checks, "Classification checks");
  const dependencies = value.dependencies ?? 0;
  if (!Number.isSafeInteger(dependencies) || dependencies < 0) throw new Error("Classification dependencies must be a nonnegative integer");
  if (value.parallelSafe !== undefined && typeof value.parallelSafe !== "boolean") throw new Error("Classification parallelSafe must be boolean");
  const lines = [
    "[FACTORY_TASK_V1]",
    `encoder_version: ${ENCODER_VERSION}`,
    `operation: ${task.accessFamily}`,
    `task_type: ${task.taskType}`,
    "instructions:",
    redact(task.instructions),
    "acceptance:",
    ...acceptance.map((entry) => `- ${redact(entry.replace(/\r\n?/g, "\n"))}`),
    "read_paths:",
    ...task.readPaths.map((entry) => `- ${entry}`),
    "write_paths:",
    ...task.writePaths.map((entry) => `- ${entry}`),
    "checks:",
    ...checks.map((entry) => `- ${redact(entry.replace(/\r\n?/g, "\n"))}`),
    `dependencies: ${dependencies}`,
    `parallel_safe: ${value.parallelSafe ?? false}`,
  ];
  const text = `${lines.join("\n")}\n`;
  const size = Buffer.byteLength(text, "utf8");
  if (size > maxInputBytes) throw new Error(`Classification input exceeds ${maxInputBytes} bytes`);
  return {
    text,
    bytes: size,
    hash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    encoderVersion: ENCODER_VERSION,
  };
}

export function validateRouterResponse(value, { taskId, classification }) {
  const fail = (detail) => {
    throw new Error(`Router response is invalid: ${detail}`);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected an object");
  if (value && (Object.keys(value).length !== RESPONSE_FIELDS.size
    || Object.keys(value).some((key) => !RESPONSE_FIELDS.has(key)))) fail("unexpected fields");
  if (value.schemaVersion !== 1) fail("schemaVersion");
  if (value.taskId !== taskId) fail("taskId");
  if (value.router !== "factory_bert" || value.router !== classification.router) fail("router");
  if (typeof value.difficultyScore !== "number" || !Number.isFinite(value.difficultyScore)
    || value.difficultyScore < 0 || value.difficultyScore > 1) fail("difficultyScore");
  if (value.scoreMeaning !== "probability_stronger_lane_required") fail("scoreMeaning");
  if (value.checkpointFingerprint !== classification.checkpointFingerprint) fail("checkpoint fingerprint");
  if (value.thresholdSet !== classification.thresholdSet) fail("threshold set");
  if (value.thresholdFingerprint !== classification.thresholdFingerprint) fail("threshold fingerprint");
  if (value.reviewThreshold !== classification.reviewThreshold) fail("review threshold");
  if (value.criticalEscalationThreshold !== classification.criticalEscalationThreshold) fail("critical escalation threshold");
  if (!Number.isSafeInteger(value.criticalFalseNegatives) || value.criticalFalseNegatives < 0) fail("critical false negatives");
  if (classification.mode === "enforce" && value.criticalFalseNegatives !== 0) fail("enforce mode requires zero critical false negatives");
  if (value.routeLLMRevision !== ROUTELLM_REVISION) fail("RouteLLM revision");
  if (!Number.isSafeInteger(value.durationMs) || value.durationMs < 0) fail("durationMs");
  return value;
}

async function invokeFactoryRouter({ request, classification }) {
  const scratch = mkdtempSync(path.join(tmpdir(), "codex-factory-router-"));
  const requestPath = path.join(scratch, "request.json");
  let stdout = "";
  let stderr = "";
  try {
    writeFileSync(requestPath, `${JSON.stringify(request)}\n`, { encoding: "utf8", flag: "wx" });
    const python = path.resolve(ROOT, classification.python);
    const processResult = await superviseProcess({
      command: python,
      args: ["-m", "codex_factory_router.adapter", "--request", requestPath],
      cwd: ROOT,
      prompt: "",
      timeoutMs: classification.timeoutSeconds * 1000,
      maxStdoutBytes: classification.maxOutputBytes,
      maxStderrBytes: classification.maxOutputBytes,
      onStdout: (chunk) => { stdout += chunk.toString("utf8"); },
      onStderr: (chunk) => { stderr += chunk.toString("utf8"); },
    });
    if (processResult.timedOut) throw new Error("Factory router inference timed out");
    if (processResult.interrupted || processResult.exitCode !== 0) {
      throw new Error(`Factory router exited unsuccessfully: ${stderr.trim() || `status ${processResult.exitCode}`}`);
    }
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length !== 1) throw new Error("Factory router must write exactly one JSON object");
    return {
      response: JSON.parse(lines[0]),
      evidence: {
        stderr,
        exitCode: processResult.exitCode,
        timedOut: processResult.timedOut,
      },
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function roleAtLeast(classifiedRole, requestedRole) {
  if (requestedRole === "auto") return classifiedRole;
  if (ROLE_FAMILY[requestedRole] === "write") {
    return requestedRole === "critical" || classifiedRole === "critical" ? "critical" : "standard";
  }
  if (requestedRole === "review" || classifiedRole === "review") return "review";
  return requestedRole;
}

function writeReceipt(receiptDirectory, receipt) {
  if (!receiptDirectory) return;
  mkdirSync(receiptDirectory, { recursive: true });
  writeFileSync(path.join(receiptDirectory, "classification.json"), `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

export async function classifyFactoryRole({
  task: taskValue,
  classification: classificationValue,
  scoreTask = invokeFactoryRouter,
  receiptDirectory,
}) {
  const classification = validateClassificationConfig(classificationValue);
  const requestedRole = taskValue?.requestedRole;
  if (classification.mode === "off") {
    if (requestedRole === "auto") throw new Error("Role auto requires classification mode shadow or enforce");
    return {
      requestedRole,
      effectiveRole: requestedRole,
      executionRole: requestedRole,
      previewOnly: false,
      classificationAvailable: false,
    };
  }
  if (requestedRole !== "auto" && !classification.checkExplicitRoles) {
    return {
      requestedRole,
      effectiveRole: requestedRole,
      executionRole: requestedRole,
      previewOnly: false,
      classificationAvailable: false,
    };
  }

  const policy = classifyDeterministicPolicy(taskValue);
  if (requestedRole !== "auto" && ROLE_FAMILY[requestedRole] !== policy.accessFamily) {
    throw new Error(`Explicit role ${requestedRole} conflicts with declared ${policy.accessFamily} access family`);
  }
  const encoded = encodeFactoryTask(taskValue, { maxInputBytes: classification.maxInputBytes });
  let routeLLM = null;
  let classifierEvidence = null;
  let classifiedRole = policy.riskFloor;
  let classificationAvailable = true;
  let classificationError = null;

  if (classification.router === "factory_bert") {
    const request = {
      schemaVersion: 1,
      taskId: policy.task.id,
      encodedTask: encoded.text,
      router: "factory_bert",
      checkpoint: path.resolve(ROOT, classification.checkpoint),
      thresholdSet: classification.thresholdSet,
      timeoutSeconds: classification.timeoutSeconds,
    };
    try {
      const scored = await scoreTask({ request, classification });
      const rawResponse = scored?.response ?? scored;
      routeLLM = validateRouterResponse(rawResponse, { taskId: policy.task.id, classification });
      classifierEvidence = scored?.evidence ?? null;
      classifiedRole = combineRoleDecision({
        policy,
        difficultyScore: routeLLM.difficultyScore,
        reviewThreshold: routeLLM.reviewThreshold,
        criticalEscalationThreshold: routeLLM.criticalEscalationThreshold,
      }).effectiveRole;
    } catch (error) {
      classificationAvailable = false;
      classificationError = error instanceof Error ? error.message : String(error);
      if (classification.onClassifierFailure === "stop" || requestedRole === "auto" || classification.mode === "enforce") {
        writeReceipt(receiptDirectory, {
          schemaVersion: 1,
          taskId: policy.task.id,
          requestedRole,
          accessFamily: policy.accessFamily,
          taskType: policy.task.taskType,
          deterministicFloor: policy.riskFloor,
          riskTriggers: policy.riskTriggers,
          conservativeAutoWrite: policy.conservativeAutoWrite,
          declarationConflict: policy.declarationConflict,
          routeLLM: null,
          classifierEvidence,
          classificationAvailable,
          classificationError,
          effectiveRole: policy.riskFloor,
          executionRole: null,
          previewOnly: false,
          policyVersion: policy.policyVersion,
          encoderVersion: encoded.encoderVersion,
          encodedTaskHash: encoded.hash,
          encodedTaskBytes: encoded.bytes,
        });
        throw error;
      }
    }
  }

  const effectiveRole = roleAtLeast(classifiedRole, requestedRole);
  const previewOnly = classification.mode === "shadow" && requestedRole === "auto";
  const executionRole = classification.mode === "enforce"
    ? effectiveRole
    : previewOnly
      ? null
      : requestedRole;
  const receipt = {
    schemaVersion: 1,
    taskId: policy.task.id,
    requestedRole,
    accessFamily: policy.accessFamily,
    taskType: policy.task.taskType,
    deterministicFloor: policy.riskFloor,
    riskTriggers: policy.riskTriggers,
    conservativeAutoWrite: policy.conservativeAutoWrite,
    declarationConflict: policy.declarationConflict,
    routeLLM: routeLLM && {
      router: routeLLM.router,
      difficultyScore: routeLLM.difficultyScore,
      checkpointFingerprint: routeLLM.checkpointFingerprint,
      thresholdSet: routeLLM.thresholdSet,
      thresholdFingerprint: routeLLM.thresholdFingerprint,
      reviewThreshold: routeLLM.reviewThreshold,
      criticalEscalationThreshold: routeLLM.criticalEscalationThreshold,
      criticalFalseNegatives: routeLLM.criticalFalseNegatives,
      revision: routeLLM.routeLLMRevision,
      durationMs: routeLLM.durationMs,
    },
    classifierEvidence,
    classificationAvailable,
    classificationError,
    effectiveRole,
    executionRole,
    previewOnly,
    policyVersion: policy.policyVersion,
    encoderVersion: encoded.encoderVersion,
    encodedTaskHash: encoded.hash,
    encodedTaskBytes: encoded.bytes,
  };
  writeReceipt(receiptDirectory, receipt);
  return receipt;
}
