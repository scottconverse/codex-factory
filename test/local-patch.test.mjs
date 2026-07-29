import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOllamaRequest,
  parseOllamaResponse,
  validateCheckWorkspace,
  validateGeneratedFiles,
  validateLocalTask,
} from "../scripts/run-local-patch.mjs";

function validTask(overrides = {}) {
  return {
    version: 1,
    taskId: "local-slugify",
    repository: "C:\\repo",
    base: "HEAD",
    model: "qwen3.5:9b",
    timeoutMinutes: 3,
    maxOutputTokens: 2048,
    maxContextBytes: 65536,
    instructions: "Implement slugify from the supplied test.",
    readPaths: ["package.json", "test/slugify.test.mjs"],
    writePaths: ["src/slugify.mjs"],
    check: {
      command: "node",
      args: ["--test", "test/slugify.test.mjs"],
    },
    commitMessage: "feat: implement slugify",
    ...overrides,
  };
}

test("validateLocalTask uses wall time and output safety without a token budget", () => {
  const task = validateLocalTask(validTask());
  assert.equal(task.timeoutMinutes, 3);
  assert.equal(task.maxOutputTokens, 2048);
  assert.equal(task.maxContextBytes, 65536);
  assert.equal("tokenReservation" in task, false);
  assert.equal("aggregateLocalTokens" in task, false);
});

test("validateLocalTask rejects unsafe paths and shell-shaped checks", () => {
  assert.throws(
    () => validateLocalTask(validTask({ writePaths: ["../outside.mjs"] })),
    /relative repository path/,
  );
  assert.throws(
    () => validateLocalTask(validTask({ readPaths: ["C:\\outside.txt"] })),
    /relative repository path/,
  );
  assert.throws(
    () => validateLocalTask(validTask({ writePaths: ["src/file:stream"] })),
    /unsafe characters/,
  );
  assert.throws(
    () => validateLocalTask(validTask({ check: { command: "node && whoami", args: [] } })),
    /plain executable name or absolute path/,
  );
});

test("buildOllamaRequest requests one schema-bound patch without tools", () => {
  const request = buildOllamaRequest({
    task: validTask(),
    prompt: "bounded prompt",
  });
  assert.equal(request.model, "qwen3.5:9b");
  assert.equal(request.stream, false);
  assert.equal(request.think, false);
  assert.equal(request.prompt, "bounded prompt");
  assert.equal(request.options.num_predict, 2048);
  assert.deepEqual(request.format.required, ["files", "summary"]);
  assert.equal("tools" in request, false);
});

test("parseOllamaResponse retains local token counts as telemetry", () => {
  const parsed = parseOllamaResponse(JSON.stringify({
    response: JSON.stringify({
      files: [{ path: "src/a.mjs", content: "export const a = 1;\n" }],
      summary: "Adds a.",
    }),
    prompt_eval_count: 100,
    eval_count: 25,
    total_duration: 123,
  }));
  assert.equal(parsed.artifact.summary, "Adds a.");
  assert.deepEqual(parsed.artifact.files, [{ path: "src/a.mjs", content: "export const a = 1;\n" }]);
  assert.deepEqual(parsed.telemetry, {
    promptTokens: 100,
    outputTokens: 25,
    totalTokens: 125,
    totalDurationNs: 123,
  });
});

test("validateGeneratedFiles accepts only declared writes", () => {
  const files = [{ path: "src/slugify.mjs", content: "export const slugify = () => \"ok\";\n" }];
  assert.deepEqual(validateGeneratedFiles(files, ["src/slugify.mjs"]), files);
  assert.throws(() => validateGeneratedFiles(files, ["src/other.mjs"]), /outside allowed write paths/);
});

test("validateGeneratedFiles rejects traversal, duplicates, and binary content", () => {
  assert.throws(
    () => validateGeneratedFiles([{ path: "../outside", content: "x" }], ["../outside"]),
    /relative repository path/,
  );
  assert.throws(
    () => validateGeneratedFiles([
      { path: "src/a.mjs", content: "a" },
      { path: "src/a.mjs", content: "b" },
    ], ["src/a.mjs"]),
    /repeats a path/,
  );
  assert.throws(
    () => validateGeneratedFiles([{ path: "src/a.bin", content: "a\u0000b" }], ["src/a.bin"]),
    /binary content/,
  );
});

test("validateCheckWorkspace rejects check-created candidate drift", () => {
  assert.doesNotThrow(() => validateCheckWorkspace([], []));
  assert.throws(
    () => validateCheckWorkspace(["src/slugify.mjs"], []),
    /modified candidate files/,
  );
  assert.throws(
    () => validateCheckWorkspace([], ["coverage.json"]),
    /created untracked files/,
  );
});
