import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeSubprocessCoverage,
  enforceThresholds,
} from "../scripts/subprocess-coverage-check.mjs";

function profile(filename, functions) {
  return {
    result: [{
      url: `file:///tmp/factory/scripts/${filename}`,
      functions,
    }],
  };
}

test("subprocess coverage honors nested zero-count ranges and unions separate processes", () => {
  const source = "aaa\nbbb\n";
  const first = profile("runner.mjs", [{
    functionName: "",
    ranges: [
      { startOffset: 0, endOffset: source.length, count: 1 },
      { startOffset: 4, endOffset: 7, count: 0 },
    ],
  }]);
  const second = profile("runner.mjs", [{
    functionName: "",
    ranges: [
      { startOffset: 0, endOffset: source.length, count: 0 },
      { startOffset: 4, endOffset: 7, count: 1 },
    ],
  }]);
  const partial = analyzeSubprocessCoverage({ profiles: [first], filename: "runner.mjs", source });
  assert.equal(partial.coveredLines, 1);
  assert.equal(partial.totalLines, 2);
  const union = analyzeSubprocessCoverage({ profiles: [first, second], filename: "runner.mjs", source });
  assert.equal(union.coveredLines, 2);
});

test("subprocess coverage unions named function execution and enforces both floors", () => {
  const source = "function a() {}\nfunction b() {}\n";
  const ranges = (a, b) => [
    {
      functionName: "",
      ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }],
    },
    {
      functionName: "a",
      ranges: [{ startOffset: 0, endOffset: 15, count: a }],
    },
    {
      functionName: "b",
      ranges: [{ startOffset: 16, endOffset: 31, count: b }],
    },
  ];
  const metrics = analyzeSubprocessCoverage({
    profiles: [profile("runner.mjs", ranges(1, 0)), profile("runner.mjs", ranges(0, 1))],
    filename: "runner.mjs",
    source,
  });
  assert.equal(metrics.coveredFunctions, 2);
  assert.equal(metrics.totalFunctions, 2);
  assert.doesNotThrow(() => enforceThresholds(metrics, { lines: 100, functions: 100 }, "runner.mjs"));
  assert.throws(
    () => enforceThresholds({ ...metrics, functions: 99 }, { lines: 100, functions: 100 }, "runner.mjs"),
    /functions coverage/,
  );
});
