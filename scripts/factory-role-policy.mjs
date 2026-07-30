const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ROLE_SET = new Set(["auto", "local-read", "mechanical", "review", "standard", "critical"]);
const ACCESS_FAMILIES = new Set(["read", "write"]);
const READ_TASK_TYPES = new Map([
  ["inventory", "local-read"],
  ["mechanical", "mechanical"],
  ["review", "review"],
]);
const WRITE_TASK_TYPES = new Set(["implementation"]);
const MAX_INSTRUCTION_BYTES = 24_576;
const MAX_PATHS = 256;

export const POLICY_VERSION = "3";
export const CRITICAL_TRIGGER_CODES = Object.freeze([
  "AUTH_OR_SECRETS",
  "MONEY",
  "PERSISTED_DATA",
  "SECURITY_OR_PRIVACY",
  "CONCURRENCY_OR_ORDER",
  "INSTALL_OR_DEPLOY",
  "IRREVERSIBLE",
]);

const TRIGGER_PATTERNS = Object.freeze({
  AUTH_OR_SECRETS: /\b(auth(?:entication|orization)?|authn|authz|login|sign[- ]?in|access control|account permissions?|permissions?|administrator roles?|tenant roles?|mfa|multi[- ]?factor|2fa|session[-_ ]?token|access[-_ ]?token|jwt|api[-_ ]?key|credential|secret|password|oauth|sso|certificate|private key)\b/i,
  MONEY: /\b(payment|billing|invoice|refund|chargeback|payout|financial transaction|money|fee|subscription pricing|price change|tax calculation)\b/i,
  PERSISTED_DATA: /\b(database|migration|schema change|alter (?:the )?.{0,24}table|add (?:a )?column|drop (?:the )?.{0,24}table|persisted (?:data|record)|data retention|(?:delete|remove|purge)\b.{0,48}\b(?:customer|account|user|record|data)|(?:customer|account|user|record|data)\b.{0,48}\b(?:deletion|removal|purge))\b/i,
  SECURITY_OR_PRIVACY: /\b(security control|authorization enforcement|permission enforcement|encrypt(?:ion|ed|ing)?|decrypt(?:ion|ed|ing)?|privacy|personal data|pii|vulnerability|rate limit(?:ing)?|firewall|csrf|xss|sanitiz(?:e|ation)|certificate)\b/i,
  CONCURRENCY_OR_ORDER: /\b(concurren(?:t|cy)|parallel (?:worker|job|process|task)|duplicate (?:queue )?jobs?|lock ordering|deadlock|race condition|idempotenc(?:y|e)|event ordering|mutex|semaphore|atomic update)\b/i,
  INSTALL_OR_DEPLOY: /\b(install(?:er|ation)?|deploy(?:ment)?|production rollout|release publication|publish (?:the )?(?:new )?build|live (?:kubernetes )?cluster|kubernetes|k8s|helm release|rollback)\b/i,
  IRREVERSIBLE: /\b(permanently delete|record deletion|customer deletion|account deletion|irreversible|destructive (?:delete|removal|purge)|cannot be undone|wipe (?:data|records|database)|truncate (?:every |all )?.{0,32}(?:row|table)|drop table)\b/i,
});

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function normalizePath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\0") || /^[A-Za-z]:[\\/]/.test(value)
    || value.startsWith("/") || value.startsWith("\\\\")) {
    throw new Error(`${label} must be a relative repository path`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} must not contain empty or traversal segments`);
  }
  return normalized;
}

function normalizePaths(value, label) {
  if (!Array.isArray(value) || value.length > MAX_PATHS) throw new Error(`${label} must be a bounded array`);
  return [...new Set(value.map((entry) => normalizePath(entry, label)))].sort();
}

export function normalizeClassificationTask(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Classification task must be an object");
  if (!ID_PATTERN.test(value.id ?? "")) throw new Error("Classification task ID is invalid");
  if (!ROLE_SET.has(value.requestedRole)) throw new Error("Classification requested role is invalid");
  if (!ACCESS_FAMILIES.has(value.accessFamily)) throw new Error("Classification access family must be read or write");
  if (![...READ_TASK_TYPES.keys(), ...WRITE_TASK_TYPES].includes(value.taskType)) {
    throw new Error("Classification task type is invalid");
  }
  if (typeof value.instructions !== "string" || value.instructions.trim().length < 10
    || byteLength(value.instructions) > MAX_INSTRUCTION_BYTES) {
    throw new Error("Classification instructions are incomplete or too large");
  }
  const readPaths = normalizePaths(value.readPaths ?? [], "Classification read path");
  const writePaths = normalizePaths(value.writePaths ?? [], "Classification write path");
  if (value.accessFamily === "read" && writePaths.length) throw new Error("Read access cannot declare write paths");
  if (value.accessFamily === "write" && !writePaths.length) throw new Error("Write access requires at least one write path");
  if (value.accessFamily === "read" && !READ_TASK_TYPES.has(value.taskType)) {
    throw new Error(`Task type ${value.taskType} does not match read access family`);
  }
  if (value.accessFamily === "write" && !WRITE_TASK_TYPES.has(value.taskType)) {
    throw new Error(`Task type ${value.taskType} does not match write access family`);
  }
  return {
    id: value.id,
    requestedRole: value.requestedRole,
    accessFamily: value.accessFamily,
    taskType: value.taskType,
    instructions: value.instructions.replace(/\r\n?/g, "\n").trim(),
    readPaths,
    writePaths,
    policyVersion: POLICY_VERSION,
  };
}

export function classifyDeterministicPolicy(value) {
  const task = normalizeClassificationTask(value);
  const riskTriggers = [];
  if (task.accessFamily === "write") {
    const evidence = `${task.instructions}\n${task.readPaths.join("\n")}\n${task.writePaths.join("\n")}`;
    for (const code of CRITICAL_TRIGGER_CODES) {
      if (TRIGGER_PATTERNS[code].test(evidence)) riskTriggers.push(code);
    }
  }
  const riskFloor = riskTriggers.length
    ? "critical"
    : task.accessFamily === "write" && task.requestedRole === "auto"
      ? "critical"
    : task.accessFamily === "write"
      ? "standard"
      : READ_TASK_TYPES.get(task.taskType);
  return {
    task,
    accessFamily: task.accessFamily,
    riskFloor,
    riskTriggers,
    conservativeAutoWrite: task.accessFamily === "write" && task.requestedRole === "auto" && riskTriggers.length === 0,
    declarationConflict: false,
    policyVersion: POLICY_VERSION,
  };
}

function validateProbability(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite number from 0 through 1`);
  }
}

export function combineRoleDecision({
  policy,
  difficultyScore,
  reviewThreshold,
  criticalEscalationThreshold,
}) {
  if (!policy || !["read", "write"].includes(policy.accessFamily)) throw new Error("Deterministic policy is invalid");
  validateProbability(difficultyScore, "Difficulty score");
  validateProbability(reviewThreshold, "Review threshold");
  validateProbability(criticalEscalationThreshold, "Critical escalation threshold");
  if (reviewThreshold > criticalEscalationThreshold) {
    throw new Error("Review threshold must not exceed the critical escalation threshold");
  }

  let effectiveRole = policy.riskFloor;
  if (policy.riskFloor !== "critical") {
    if (policy.accessFamily === "write" && difficultyScore >= criticalEscalationThreshold) {
      effectiveRole = "critical";
    } else if (policy.accessFamily === "read" && difficultyScore >= reviewThreshold) {
      effectiveRole = "review";
    }
  }
  return {
    effectiveRole,
    requiresOperatorReview: effectiveRole === "critical",
  };
}
