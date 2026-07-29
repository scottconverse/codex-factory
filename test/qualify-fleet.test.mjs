import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateLocalQualification,
  filterQualificationPlan,
  parseQualificationArgs,
} from "../scripts/qualify-fleet.mjs";

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
