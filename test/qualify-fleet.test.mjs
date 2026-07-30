import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverCandidatesForOptions,
  evaluateLocalQualification,
  filterQualificationPlan,
  parseQualificationArgs,
  removeQualificationFixture,
  withQualificationFixture,
} from "../scripts/qualify-fleet.mjs";

test("an explicit OpenAI qualification does not require a live Ollama endpoint", async () => {
  const config = {
    candidates: {
      openai: [{
        model: "gpt-5.6-luna",
        tier: "economy",
        reasoningEffort: "low",
        paid: true,
        tokenReservation: 20_000,
        runtimeVersion: "test",
      }],
    },
  };
  const candidates = await discoverCandidatesForOptions(
    config,
    { provider: "openai" },
    async () => { throw new Error("Ollama must not be contacted"); },
  );
  assert.deepEqual(candidates.map(({ provider, model }) => ({ provider, model })), [
    { provider: "openai", model: "gpt-5.6-luna" },
  ]);
});

test("qualification defaults to every candidate and keeps execution explicit", () => {
  assert.deepEqual(parseQualificationArgs([]), {
    execute: false,
    includePaid: false,
    provider: null,
    model: null,
    role: null,
  });
});

test("qualification filters are optional and never silently add paid candidates", () => {
  const plan = [
    { provider: "ollama", model: "qwen3.5:9b", role: "analysis" },
    { provider: "ollama", model: "gemma4:12b", role: "structured_write" },
    { provider: "openai", model: "gpt-5.6-luna", role: "analysis" },
  ];
  assert.deepEqual(filterQualificationPlan(plan, parseQualificationArgs([])), plan.slice(0, 2));
  assert.deepEqual(
    filterQualificationPlan(plan, parseQualificationArgs(["--include-paid", "--model", "gpt-5.6-luna"])),
    plan.slice(2),
  );
});

test("local qualification evaluates exact role artifacts", () => {
  assert.deepEqual(
    evaluateLocalQualification("analysis", { response: "CODEX_FACTORY_ANALYSIS_QUALIFIED" }),
    { passed: true, detail: "exact analysis artifact returned" },
  );
  assert.equal(evaluateLocalQualification("analysis", { response: "extra CODEX_FACTORY_ANALYSIS_QUALIFIED" }).passed, false);
  assert.deepEqual(
    evaluateLocalQualification("benchmark", {
      response: '{"valid":false,"reason":"60 mm exceeds 40 mm","holeCount":4}',
    }),
    { passed: true, detail: "structured reasoning benchmark passed" },
  );
  assert.equal(
    evaluateLocalQualification("benchmark", {
      response: '{"valid":true,"reason":"fits","holeCount":2}',
    }).passed,
    false,
  );
  assert.deepEqual(
    evaluateLocalQualification("structured_write", {
      response: JSON.stringify({
        files: [{ path: "src/value.mjs", content: "export const value = 42;\n" }],
        summary: "Implemented the fixture.",
      }),
    }),
    { passed: true, detail: "exact structured-write artifact returned" },
  );
  assert.equal(
    evaluateLocalQualification("structured_write", {
      response: JSON.stringify({
        files: [{ path: "src/value.mjs", content: "export const value = 41;\n" }],
        summary: "Wrong.",
      }),
    }).passed,
    false,
  );
});

test("qualification fixture cleanup uses bounded Windows-friendly retries", () => {
  let observed = null;
  removeQualificationFixture("fixture", (fixture, options) => {
    observed = { fixture, options };
  });
  assert.deepEqual(observed, {
    fixture: "fixture",
    options: {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    },
  });
});

test("paid qualification removes its temporary fixture when supervision throws", async (context) => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "factory-qualification-cleanup-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const fixture = path.join(parent, "fixture");
  const receiptPath = path.join(parent, "receipt");
  const failure = Object.assign(new Error("child was not reaped"), {
    code: "PROCESS_NOT_REAPED",
    childPid: 123,
    processGroup: 123,
  });
  await assert.rejects(
    withQualificationFixture(
      () => {
        mkdirSync(fixture);
        return fixture;
      },
      async () => { throw failure; },
    ),
    (error) => error === failure,
  );
  assert.equal(existsSync(fixture), false);
});

test("paid qualification removes its temporary fixture after success", async (context) => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "factory-qualification-success-"));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const fixture = path.join(parent, "fixture");
  const result = await withQualificationFixture(
    () => {
      mkdirSync(fixture);
      return fixture;
    },
    async () => "accepted",
  );
  assert.equal(result, "accepted");
  assert.equal(existsSync(fixture), false);
});

test("paid qualification preserves its primary error when fixture cleanup also fails", async () => {
  const failure = Object.assign(new Error("child was not reaped"), { code: "PROCESS_NOT_REAPED" });
  await assert.rejects(
    withQualificationFixture(
      () => "fixture",
      async () => { throw failure; },
      () => { throw new Error("access denied"); },
    ),
    (error) => error === failure
      && error.cleanupError === "access denied"
      && /fixture cleanup failed/.test(error.message),
  );
});

test("paid qualification surfaces a cleanup failure after successful work", async () => {
  await assert.rejects(
    withQualificationFixture(
      () => "fixture",
      async () => "accepted",
      () => { throw new Error("access denied"); },
    ),
    /access denied/,
  );
});
