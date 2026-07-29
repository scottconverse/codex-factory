import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateFingerprint,
  discoverCandidatePool,
  parseOllamaDiscovery,
  qualificationPlan,
  selectCandidate,
} from "../scripts/factory-fleet.mjs";

const config = {
  candidates: {
    openai: [
      { model: "gpt-5.6-luna", tier: "economy", reasoningEffort: "low", paid: true },
      { model: "gpt-5.6-terra", tier: "standard", reasoningEffort: "medium", paid: true },
      { model: "gpt-5.6-sol", tier: "premium", reasoningEffort: "high", paid: true },
    ],
  },
};

test("candidate discovery includes every local model and every configured Codex model", () => {
  const candidates = discoverCandidatePool({
    config,
    ollama: {
      runtimeVersion: "0.11.4",
      models: ["qwen3.5:9b", "gemma4:12b", "mellum2:latest"],
    },
  });
  assert.deepEqual(
    candidates.map(({ provider, model }) => `${provider}:${model}`),
    [
      "ollama:qwen3.5:9b",
      "ollama:gemma4:12b",
      "ollama:mellum2:latest",
      "openai:gpt-5.6-luna",
      "openai:gpt-5.6-terra",
      "openai:gpt-5.6-sol",
    ],
  );
});

test("Ollama discovery retains every installed non-empty model name", () => {
  assert.deepEqual(
    parseOllamaDiscovery(
      { version: "0.11.4" },
      { models: [
        { name: "qwen3.5:9b", capabilities: ["completion", "tools"] },
        { name: "gemma4:12b", capabilities: ["completion"] },
        { name: "" },
        {},
      ] },
    ),
    {
      runtimeVersion: "0.11.4",
      models: [
        { name: "qwen3.5:9b", capabilities: ["completion", "tools"] },
        { name: "gemma4:12b", capabilities: ["completion"] },
      ],
    },
  );
});

test("qualification covers all worker-capable models but not embedding-only inventory", () => {
  const candidates = discoverCandidatePool({
    config: { candidates: { openai: [] } },
    ollama: {
      runtimeVersion: "0.11.4",
      models: [
        { name: "qwen3.5:9b", capabilities: ["completion", "tools"] },
        { name: "qwen3-vl:4b", capabilities: ["completion", "vision"] },
        { name: "nomic-embed-text:latest", capabilities: ["embedding"] },
      ],
    },
  });
  assert.equal(candidates.length, 3, "inventory retains every discovered model");
  assert.deepEqual(
    [...new Set(qualificationPlan(candidates).map(({ model }) => model))],
    ["qwen3.5:9b", "qwen3-vl:4b"],
  );
});

test("qualification plan tests every candidate against each supported role harness", () => {
  const candidates = discoverCandidatePool({
    config,
    ollama: { runtimeVersion: "0.11.4", models: ["qwen3.5:9b", "gemma4:12b"] },
  });
  const plan = qualificationPlan(candidates);
  assert.deepEqual(
    plan.map(({ model, role }) => `${model}:${role}`),
    [
      "qwen3.5:9b:analysis",
      "qwen3.5:9b:benchmark",
      "qwen3.5:9b:structured_write",
      "gemma4:12b:analysis",
      "gemma4:12b:benchmark",
      "gemma4:12b:structured_write",
      "gpt-5.6-luna:analysis",
      "gpt-5.6-luna:benchmark",
      "gpt-5.6-luna:workspace_write",
      "gpt-5.6-terra:analysis",
      "gpt-5.6-terra:benchmark",
      "gpt-5.6-terra:workspace_write",
      "gpt-5.6-sol:analysis",
      "gpt-5.6-sol:benchmark",
      "gpt-5.6-sol:workspace_write",
    ],
  );
});

test("routing keeps failures role-scoped and selects from exact current qualifications", () => {
  const candidates = discoverCandidatePool({
    config,
    ollama: { runtimeVersion: "0.11.4", models: ["qwen3.5:9b", "gemma4:12b"] },
  });
  const byModel = new Map(candidates.map((candidate) => [candidate.model, candidate]));
  const qualification = (model, role, passed) => ({
    candidateId: byModel.get(model).id,
    fingerprint: candidateFingerprint(byModel.get(model), role),
    role,
    passed,
  });
  const qualifications = [
    qualification("qwen3.5:9b", "analysis", true),
    qualification("qwen3.5:9b", "benchmark", true),
    qualification("qwen3.5:9b", "structured_write", false),
    qualification("gemma4:12b", "analysis", false),
    qualification("gemma4:12b", "benchmark", true),
    qualification("gemma4:12b", "structured_write", true),
    qualification("gpt-5.6-luna", "analysis", true),
    qualification("gpt-5.6-luna", "benchmark", true),
    qualification("gpt-5.6-luna", "workspace_write", true),
    qualification("gpt-5.6-terra", "analysis", true),
    qualification("gpt-5.6-terra", "benchmark", true),
    qualification("gpt-5.6-terra", "workspace_write", true),
    qualification("gpt-5.6-sol", "analysis", true),
    qualification("gpt-5.6-sol", "benchmark", true),
    qualification("gpt-5.6-sol", "workspace_write", true),
  ];

  assert.equal(selectCandidate({ candidates, qualifications, role: "analysis", requiredTier: "economy" }).model, "qwen3.5:9b");
  assert.equal(selectCandidate({ candidates, qualifications, role: "structured_write", requiredTier: "standard" }).model, "gemma4:12b");
  assert.equal(selectCandidate({ candidates, qualifications, role: "workspace_write", requiredTier: "economy" }).model, "gpt-5.6-luna");
});

test("routing rejects stale qualifications after a runtime fingerprint changes", () => {
  const oldCandidate = discoverCandidatePool({
    config: { candidates: { openai: [] } },
    ollama: { runtimeVersion: "0.11.3", models: ["gemma4:12b"] },
  })[0];
  const currentCandidate = discoverCandidatePool({
    config: { candidates: { openai: [] } },
    ollama: { runtimeVersion: "0.11.4", models: ["gemma4:12b"] },
  })[0];
  assert.throws(
    () => selectCandidate({
      candidates: [currentCandidate],
      qualifications: [{
        candidateId: oldCandidate.id,
        fingerprint: candidateFingerprint(oldCandidate, "structured_write"),
        role: "structured_write",
        passed: true,
      }],
      role: "structured_write",
      requiredTier: "standard",
    }),
    /No currently qualified candidate/,
  );
});

test("the latest result for an exact qualification replaces older evidence", () => {
  const candidate = discoverCandidatePool({
    config: { candidates: { openai: [] } },
    ollama: { runtimeVersion: "0.11.4", models: ["gemma4:12b"] },
  })[0];
  const base = {
    candidateId: candidate.id,
    fingerprint: candidateFingerprint(candidate, "structured_write"),
    role: "structured_write",
  };
  assert.throws(
    () => selectCandidate({
      candidates: [candidate],
      qualifications: [
        { ...base, passed: true, finishedAt: "2026-07-29T10:00:00.000Z" },
        { ...base, passed: false, finishedAt: "2026-07-29T11:00:00.000Z" },
      ],
      role: "structured_write",
      requiredTier: "standard",
    }),
    /No currently qualified candidate/,
  );
});
