import assert from "node:assert/strict";
import test from "node:test";
import {
  POLICY_VERSION,
  classifyDeterministicPolicy,
  combineRoleDecision,
  normalizeClassificationTask,
} from "../scripts/factory-role-policy.mjs";

const task = (overrides = {}) => ({
  id: "inspect-parser",
  requestedRole: "auto",
  accessFamily: "read",
  taskType: "inventory",
  instructions: "Inventory parser modules and report their exported functions.",
  readPaths: ["src/parser.mjs"],
  writePaths: [],
  ...overrides,
});

test("normalization preserves explicit access and task type while sorting bounded paths", () => {
  const normalized = normalizeClassificationTask(task({
    readPaths: ["test/parser.test.mjs", "src/parser.mjs", "src/parser.mjs"],
  }));
  assert.equal(normalized.accessFamily, "read");
  assert.equal(normalized.taskType, "inventory");
  assert.deepEqual(normalized.readPaths, ["src/parser.mjs", "test/parser.test.mjs"]);
  assert.equal(normalized.policyVersion, POLICY_VERSION);
});

test("read access cannot declare write paths and write access needs a write path", () => {
  assert.throws(
    () => normalizeClassificationTask(task({ writePaths: ["src/parser.mjs"] })),
    /read access.*write paths/i,
  );
  assert.throws(
    () => normalizeClassificationTask(task({ accessFamily: "write", taskType: "implementation" })),
    /write access.*write path/i,
  );
});

test("read task types map to their deterministic role floors", () => {
  assert.equal(classifyDeterministicPolicy(task()).riskFloor, "local-read");
  assert.equal(classifyDeterministicPolicy(task({
    taskType: "mechanical",
    instructions: "Transform the supplied release list into a normalized table.",
  })).riskFloor, "mechanical");
  assert.equal(classifyDeterministicPolicy(task({
    taskType: "review",
    instructions: "Review parser error handling and report correctness risks.",
  })).riskFloor, "review");
});

test("explicit writes have a standard floor while auto writes fail conservatively to Critical", () => {
  const decision = classifyDeterministicPolicy(task({
    requestedRole: "standard",
    accessFamily: "write",
    taskType: "implementation",
    instructions: "Fix quoted delimiter handling and update its tests.",
    writePaths: ["src/parser.mjs", "test/parser.test.mjs"],
  }));
  assert.equal(decision.riskFloor, "standard");
  const automatic = classifyDeterministicPolicy(task({
    accessFamily: "write",
    taskType: "implementation",
    instructions: "Fix quoted delimiter handling and update its tests.",
    writePaths: ["src/parser.mjs", "test/parser.test.mjs"],
  }));
  assert.equal(automatic.riskFloor, "critical");
  assert.equal(automatic.conservativeAutoWrite, true);
  assert.throws(
    () => classifyDeterministicPolicy(task({
      accessFamily: "write",
      taskType: "inventory",
      writePaths: ["report.md"],
    })),
    /task type.*access family/i,
  );
});

for (const [code, instructions, paths] of [
  ["AUTH_OR_SECRETS", "Change session-token rotation and update its tests.", ["src/auth/session.mjs"]],
  ["MONEY", "Change payment capture and refund behavior.", ["src/billing/payment.mjs"]],
  ["PERSISTED_DATA", "Modify the database migration for account records.", ["migrations/014-account.sql"]],
  ["SECURITY_OR_PRIVACY", "Change authorization enforcement for private profiles.", ["src/security/policy.mjs"]],
  ["CONCURRENCY_OR_ORDER", "Fix concurrent lock ordering in the queue.", ["src/queue/lock.mjs"]],
  ["INSTALL_OR_DEPLOY", "Change the production deployment and rollback flow.", ["scripts/deploy.ps1"]],
  ["IRREVERSIBLE", "Permanently delete archived customer records.", ["src/purge.mjs"]],
]) {
  test(`named critical trigger ${code} establishes a critical floor`, () => {
    const decision = classifyDeterministicPolicy(task({
      accessFamily: "write",
      taskType: "implementation",
      instructions,
      writePaths: paths,
    }));
    assert.equal(decision.riskFloor, "critical");
    assert.ok(decision.riskTriggers.includes(code));
  });
}

for (const [code, instructions, paths] of [
  ["AUTH_OR_SECRETS", "Change administrator roles for tenant accounts.", ["src/tenants/roles.mjs"]],
  ["MONEY", "Apply a fee to overdue subscriptions.", ["src/subscriptions/overdue.mjs"]],
  ["PERSISTED_DATA", "Alter the customer table to add a column.", ["src/customers/store.sql"]],
  ["CONCURRENCY_OR_ORDER", "Prevent duplicate queue jobs under parallel workers.", ["src/queue/worker.mjs"]],
  ["INSTALL_OR_DEPLOY", "Publish the new build to the live Kubernetes cluster.", ["deploy/production.yaml"]],
  ["IRREVERSIBLE", "Truncate every audit row before import.", ["src/audit/import.sql"]],
]) {
  test(`adversarial high-risk paraphrase activates ${code}`, () => {
    const decision = classifyDeterministicPolicy(task({
      accessFamily: "write",
      taskType: "implementation",
      instructions,
      writePaths: paths,
    }));
    assert.equal(decision.riskFloor, "critical");
    assert.ok(decision.riskTriggers.includes(code));
  });
}

for (const [code, instructions, paths] of [
  ["AUTH_OR_SECRETS", "Change account permissions and MFA recovery behavior.", ["src/accounts/access.mjs"]],
  ["AUTH_OR_SECRETS", "Rotate JWT signing certificates used by login.", ["src/identity/keys.mjs"]],
  ["SECURITY_OR_PRIVACY", "Encrypt customer backups at rest.", ["src/storage/backups.mjs"]],
  ["SECURITY_OR_PRIVACY", "Add login rate limiting at the gateway.", ["src/gateway/login.mjs"]],
  ["PERSISTED_DATA", "Delete inactive customer records after the retention window.", ["src/customers/cleanup.mjs"]],
]) {
  test(`sensitive write phrasing still activates ${code}`, () => {
    const decision = classifyDeterministicPolicy(task({
      accessFamily: "write",
      taskType: "implementation",
      instructions,
      writePaths: paths,
    }));
    assert.equal(decision.riskFloor, "critical");
    assert.ok(decision.riskTriggers.includes(code));
  });
}

for (const [instructions, paths] of [
  ["Grant RBAC access to tenant operators.", ["src/tenants/rbac.mjs"]],
  ["Change recurring plan costs for annual accounts.", ["src/plans/annual.mjs"]],
  ["Backfill customer rows from the legacy store.", ["scripts/backfill-customers.mjs"]],
  ["Validate untrusted HTML before rendering.", ["src/web/sanitize.mjs"]],
  ["Make queue processing exactly once.", ["src/queue/processor.mjs"]],
  ["Promote the container image to prod.", ["deploy/promote.ps1"]],
  ["Empty the audit log before import.", ["src/audit/import.mjs"]],
]) {
  test("rules-only auto write remains Critical when vocabulary does not match", () => {
    const decision = classifyDeterministicPolicy(task({
      accessFamily: "write",
      taskType: "implementation",
      instructions,
      writePaths: paths,
    }));
    assert.equal(decision.riskFloor, "critical");
    assert.equal(decision.conservativeAutoWrite, decision.riskTriggers.length === 0);
  });
}

test("read-only inspection and documentation near-matches do not become critical", () => {
  for (const candidate of [
    task({ taskType: "review", instructions: "Inspect authentication code and report its current behavior.", readPaths: ["src/auth/session.mjs"] }),
    task({ taskType: "mechanical", instructions: "Document deployment instructions without performing or changing deployment.", readPaths: ["docs/deploy.md"] }),
    task({ taskType: "review", instructions: "Review lock ordering without changing concurrent behavior.", readPaths: ["src/queue/lock.mjs"] }),
  ]) {
    const decision = classifyDeterministicPolicy(candidate);
    assert.notEqual(decision.riskFloor, "critical");
    assert.deepEqual(decision.riskTriggers, []);
  }
});

test("combiner escalates by score but never lowers the deterministic floor or access family", () => {
  const read = classifyDeterministicPolicy(task({ taskType: "mechanical" }));
  assert.equal(combineRoleDecision({ policy: read, difficultyScore: 0.2, reviewThreshold: 0.55, criticalEscalationThreshold: 0.9 }).effectiveRole, "mechanical");
  assert.equal(combineRoleDecision({ policy: read, difficultyScore: 0.55, reviewThreshold: 0.55, criticalEscalationThreshold: 0.9 }).effectiveRole, "review");

  const write = classifyDeterministicPolicy(task({
    requestedRole: "standard",
    accessFamily: "write",
    taskType: "implementation",
    writePaths: ["src/parser.mjs"],
  }));
  assert.equal(combineRoleDecision({ policy: write, difficultyScore: 0.1, reviewThreshold: 0.55, criticalEscalationThreshold: 0.9 }).effectiveRole, "standard");
  assert.equal(combineRoleDecision({ policy: write, difficultyScore: 0.9, reviewThreshold: 0.55, criticalEscalationThreshold: 0.9 }).effectiveRole, "critical");

  const critical = classifyDeterministicPolicy(task({
    accessFamily: "write",
    taskType: "implementation",
    instructions: "Change session-token rotation.",
    writePaths: ["src/auth/session.mjs"],
  }));
  assert.equal(combineRoleDecision({ policy: critical, difficultyScore: 0, reviewThreshold: 0.55, criticalEscalationThreshold: 0.9 }).effectiveRole, "critical");
});

test("combiner rejects malformed scores and thresholds", () => {
  const policy = classifyDeterministicPolicy(task());
  assert.throws(() => combineRoleDecision({ policy, difficultyScore: 2, reviewThreshold: 0.55, criticalEscalationThreshold: 0.9 }), /difficulty score/i);
  assert.throws(() => combineRoleDecision({ policy, difficultyScore: 0.5, reviewThreshold: 0.9, criticalEscalationThreshold: 0.5 }), /threshold/i);
});
