import assert from "node:assert/strict";
import test from "node:test";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildInvocation, classifyResult, parseArgs, summarizeLedger, summarizeUsage, taskWasAttempted, validateConfig } from "../scripts/run-worker.mjs";

test("parseArgs keeps execution opt-in", () => {
  assert.deepEqual(parseArgs(["--task-id", "one", "--role", "mechanical"]), { taskId: "one", role: "mechanical", execute: false });
  assert.equal(parseArgs(["--execute"]).execute, true);
});

test("validateConfig rejects concurrency and retry expansion", () => {
  const base = {
    version: 1,
    budgets: { aggregatePaidTokens: 1, aggregateLocalTokens: 1, maxWorkerMinutes: 1, maxAttemptsPerTask: 2, maxConcurrentWorkers: 1 },
    routes: {},
  };
  assert.throws(() => validateConfig(base), /exactly one attempt/);
  base.budgets.maxAttemptsPerTask = 1;
  base.budgets.maxConcurrentWorkers = 2;
  assert.throws(() => validateConfig(base), /exactly one worker/);
});

test("validateConfig rejects unaccounted providers and invalid reasoning effort", () => {
  const config = {
    version: 1,
    budgets: { aggregatePaidTokens: 1, aggregateLocalTokens: 1, maxWorkerMinutes: 1, maxAttemptsPerTask: 1, maxConcurrentWorkers: 1 },
    routes: {
      review: { provider: "openai", model: "model", reasoningEffort: "high", tokenReservation: 1, sandbox: "read-only", paid: false },
    },
  };
  assert.throws(() => validateConfig(config), /provider and paid flag disagree/);
  config.routes.review.paid = true;
  config.routes.review.reasoningEffort = "unbounded";
  assert.throws(() => validateConfig(config), /unsupported reasoning effort/);
});

test("buildInvocation pins provider, model, reasoning, sandbox, and ephemeral JSONL", () => {
  const invocation = buildInvocation({
    route: { provider: "ollama", model: "qwen3.5:4b", reasoningEffort: "low", sandbox: "read-only" },
    cwd: "C:\\repo",
    outputPath: "C:\\receipt.txt",
  });
  assert.deepEqual(invocation.args.slice(0, 7), ["exec", "--oss", "--local-provider", "ollama", "-m", "qwen3.5:4b", "-c"]);
  assert.ok(invocation.args.includes("--ephemeral"));
  assert.ok(invocation.args.includes("--json"));
  assert.ok(invocation.args.includes("read-only"));
});

test("summarizeUsage rejects missing receipts and counts input plus output once", () => {
  assert.equal(summarizeUsage('{"type":"turn.started"}\n'), null);
  assert.deepEqual(
    summarizeUsage('{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":80,"output_tokens":9,"reasoning_output_tokens":2}}\n'),
    { input_tokens: 100, cached_input_tokens: 80, output_tokens: 9, reasoning_output_tokens: 2, total_tokens: 109 },
  );
});

test("summarizeLedger closes a paid lane when prior usage is unknown", () => {
  assert.equal(summarizeLedger('{"taskId":"one","paid":true,"usage":{"total_tokens":25}}\n', true), 25);
  assert.throws(() => summarizeLedger('{"taskId":"one","paid":true,"usage":null}\n', true), /without trustworthy token usage/);
  assert.equal(summarizeLedger('{"taskId":"one","paid":false,"usage":null}\n', true), 0);
  const reconciled = [
    '{"stage":"reserved","taskId":"one","paid":true,"reservedTokens":100}',
    '{"stage":"terminal","taskId":"one","paid":true,"usage":{"total_tokens":25}}',
  ].join("\n");
  assert.equal(summarizeLedger(reconciled, true), 25);
});

test("classifyResult requires a successful process, usage, output, and budget compliance", () => {
  const completed = {
    processResult: { exitCode: 0, timedOut: false },
    executionError: null,
    usage: { total_tokens: 100 },
    finalMessage: "done",
    tokenReservation: 100,
  };
  assert.equal(classifyResult(completed), "process_completed");
  assert.equal(classifyResult({ ...completed, finalMessage: "" }), "failed");
  assert.equal(classifyResult({ ...completed, usage: null }), "failed");
  assert.equal(classifyResult({ ...completed, usage: { total_tokens: 101 } }), "over_budget");
  assert.equal(classifyResult({ ...completed, processResult: { exitCode: null, timedOut: true } }), "timed_out");
});

test("taskWasAttempted rejects reuse of a durable task ID", (t) => {
  const ledgerPath = path.join(tmpdir(), `codex-factory-${process.pid}-${Date.now()}.jsonl`);
  t.after(() => rmSync(ledgerPath, { force: true }));
  writeFileSync(ledgerPath, '{"stage":"reserved","taskId":"already-ran","paid":true,"reservedTokens":10}\n');
  assert.equal(taskWasAttempted(ledgerPath, "already-ran"), true);
  assert.equal(taskWasAttempted(ledgerPath, "new-task"), false);
});
