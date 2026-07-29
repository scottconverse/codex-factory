import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAttemptLadder,
  remainingAttemptMs,
  runCampaignSchedule,
  runTaskWithFallback,
  selectReadyBatch,
  validateCampaign,
} from "../scripts/factory-campaign.mjs";
import { candidateFingerprint, discoverCandidatePool } from "../scripts/factory-fleet.mjs";

function campaign(overrides = {}) {
  return {
    version: 1,
    campaignId: "ship-widget",
    repository: ".",
    base: "HEAD",
    maxParallel: 3,
    sourceFile: "SPEC.md",
    tasks: [
      {
        id: "api",
        role: "standard",
        instructions: "Implement the API behavior from the supplied specification.",
        readPaths: ["src/api.mjs"],
        writePaths: ["src/api.mjs"],
        dependsOn: [],
        parallelSafe: true,
        check: { command: "node", args: ["--test", "test/api.test.mjs"] },
        commitMessage: "feat: implement API",
      },
      {
        id: "ui",
        role: "standard",
        instructions: "Implement the UI behavior from the supplied specification.",
        readPaths: ["src/ui.mjs"],
        writePaths: ["src/ui.mjs"],
        dependsOn: [],
        parallelSafe: true,
        check: { command: "node", args: ["--test", "test/ui.test.mjs"] },
        commitMessage: "feat: implement UI",
      },
      {
        id: "integration",
        role: "standard",
        instructions: "Connect the completed API and UI behavior.",
        readPaths: ["src/api.mjs", "src/ui.mjs"],
        writePaths: ["src/index.mjs"],
        dependsOn: ["api", "ui"],
        parallelSafe: false,
        check: { command: "node", args: ["--test"] },
        commitMessage: "feat: integrate widget",
      },
    ],
    ...overrides,
  };
}

test("validateCampaign accepts a bounded dependency plan and rejects overlapping parallel access", () => {
  assert.equal(validateCampaign(campaign()).campaignId, "ship-widget");
  const inlineSource = campaign({ sourceFile: undefined, source: "Implement the supplied owner request without expanding its scope." });
  assert.equal(validateCampaign(inlineSource).source.startsWith("Implement"), true);
  assert.throws(() => validateCampaign(campaign({ source: "duplicate source" })), /exactly one/i);
  const invalid = campaign();
  invalid.tasks[1].writePaths = ["src/api.mjs"];
  assert.throws(() => validateCampaign(invalid), /parallel tasks .* overlap/i);
  const staleRead = campaign();
  staleRead.tasks[1].readPaths = ["src/api.mjs"];
  assert.throws(() => validateCampaign(staleRead), /parallel tasks .* overlap/i);
  assert.throws(() => validateCampaign(campaign({ localAttemptMinutes: 0 })), /local attempt/i);
  assert.throws(() => validateCampaign(campaign({ sourceFile: "../outside.md" })), /traversal segments/i);
  const critical = campaign();
  critical.tasks[0].role = "critical";
  assert.throws(() => validateCampaign(critical), /unsupported campaign task role/i);
});

test("selectReadyBatch dispatches independent work together and waits for dependencies", () => {
  const plan = validateCampaign(campaign());
  assert.deepEqual(selectReadyBatch(plan.tasks, new Set(), new Set(), 3).map((task) => task.id), ["api", "ui"]);
  assert.deepEqual(selectReadyBatch(plan.tasks, new Set(["api"]), new Set(), 3).map((task) => task.id), ["ui"]);
  assert.deepEqual(selectReadyBatch(plan.tasks, new Set(["api"]), new Set(["ui"]), 3).map((task) => task.id), []);
  assert.deepEqual(selectReadyBatch(plan.tasks, new Set(["api", "ui"]), new Set(), 3).map((task) => task.id), ["integration"]);
});

test("remainingAttemptMs enforces one monotonic local-attempt deadline", () => {
  assert.equal(remainingAttemptMs(1_250, 1_000), 250);
  assert.throws(() => remainingAttemptMs(1_000, 1_000), /deadline/i);
});

test("buildAttemptLadder prefers one qualified local candidate then Luna and Terra", () => {
  const config = {
    candidates: {
      openai: [
        { model: "gpt-5.6-luna", tier: "economy", reasoningEffort: "low", tokenReservation: 20_000 },
        { model: "gpt-5.6-terra", tier: "standard", reasoningEffort: "medium", tokenReservation: 40_000 },
      ],
    },
  };
  const candidates = discoverCandidatePool({
    config,
    ollama: { runtimeVersion: "0.32.4", models: ["gemma4:12b"] },
  });
  const qualifications = candidates.flatMap((candidate) => {
    const role = candidate.provider === "ollama" ? "structured_write" : "workspace_write";
    return [
      { candidateId: candidate.id, role, fingerprint: candidateFingerprint(candidate, role), passed: true },
      { candidateId: candidate.id, role: "benchmark", fingerprint: candidateFingerprint(candidate, "benchmark"), passed: true },
    ];
  });
  assert.deepEqual(
    buildAttemptLadder({ task: campaign().tasks[0], candidates, qualifications }).map(({ provider, model }) => ({ provider, model })),
    [
      { provider: "ollama", model: "gemma4:12b" },
      { provider: "openai", model: "gpt-5.6-luna" },
      { provider: "openai", model: "gpt-5.6-terra" },
    ],
  );
});

test("buildAttemptLadder never downgrades a critical task to economy", () => {
  const candidates = discoverCandidatePool({
    config: { candidates: { openai: [{ model: "gpt-5.6-luna", tier: "economy", reasoningEffort: "low", tokenReservation: 20_000 }] } },
    ollama: { runtimeVersion: "1", models: ["local"] },
  });
  const qualifications = candidates.flatMap((candidate) => [
    { candidateId: candidate.id, role: candidate.provider === "ollama" ? "structured_write" : "workspace_write", fingerprint: candidateFingerprint(candidate, candidate.provider === "ollama" ? "structured_write" : "workspace_write"), passed: true },
    { candidateId: candidate.id, role: "benchmark", fingerprint: candidateFingerprint(candidate, "benchmark"), passed: true },
  ]);
  const critical = { ...campaign().tasks[0], role: "critical" };
  assert.deepEqual(buildAttemptLadder({ task: critical, candidates, qualifications, routes: { critical: { requiredTier: "economy" } } }), []);
});

test("runTaskWithFallback stops after Luna succeeds", async () => {
  const seen = [];
  const result = await runTaskWithFallback({
    task: campaign().tasks[0],
    attempts: [
      { provider: "ollama", model: "local" },
      { provider: "openai", model: "gpt-5.6-luna" },
      { provider: "openai", model: "gpt-5.6-terra" },
    ],
    executeAttempt: async (_task, attempt) => {
      seen.push(attempt.model);
      if (attempt.provider === "ollama") throw new Error("invalid patch");
      return { status: "accepted", commit: "abc123" };
    },
  });
  assert.deepEqual(seen, ["local", "gpt-5.6-luna"]);
  assert.equal(result.selected.model, "gpt-5.6-luna");
  assert.equal(result.failures.length, 1);
});

test("runCampaignSchedule overlaps independent tasks and serializes their dependent", async () => {
  const active = new Set();
  let peak = 0;
  const integrated = [];
  const result = await runCampaignSchedule({
    plan: validateCampaign(campaign()),
    executeTask: async (task) => {
      active.add(task.id);
      peak = Math.max(peak, active.size);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active.delete(task.id);
      return { taskId: task.id, commit: `${task.id}-commit` };
    },
    integrateBatch: async (results) => integrated.push(results.map(({ taskId }) => taskId)),
  });
  assert.equal(peak, 2);
  assert.deepEqual(integrated, [["api", "ui"], ["integration"]]);
  assert.equal(result.status, "completed");
});
