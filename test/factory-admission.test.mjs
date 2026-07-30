import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { summarizeLedger } from "../scripts/factory-admission.mjs";
import { superviseProcess } from "../scripts/factory-process.mjs";

function runFixture(name, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(import.meta.dirname, "fixtures", name), ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("close", (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

test("separate OS processes serialize paid admission against one aggregate budget", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "factory-admission-process-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const results = await Promise.all([
    runFixture("paid-admission-child.mjs", [root, "one"]),
    runFixture("paid-admission-child.mjs", [root, "two"]),
  ]);
  assert.deepEqual(results.map(({ code }) => code).sort(), [0, 1]);
  assert.match(results.find(({ code }) => code === 1).stderr, /exceeds remaining budget 40/);
  assert.equal(summarizeLedger(readFileSync(path.join(root, "usage.jsonl"), "utf8"), true), 60);
});

test("duplicate terminal reconciliation charges only the latest record for an invocation", () => {
  const ledger = [
    '{"stage":"reserved","invocationId":"inv-one","taskId":"one","paid":true,"reservedTokens":60}',
    '{"stage":"terminal","invocationId":"inv-one","taskId":"one","paid":true,"usage":{"total_tokens":25}}',
    '{"stage":"terminal","invocationId":"inv-one","taskId":"one","paid":true,"usage":{"total_tokens":30}}',
  ].join("\n");
  assert.equal(summarizeLedger(ledger, true), 30);
});

test("latest duplicate terminal with unknown paid usage still closes admission", () => {
  const ledger = [
    '{"stage":"reserved","invocationId":"inv-one","taskId":"one","paid":true,"reservedTokens":60}',
    '{"stage":"terminal","invocationId":"inv-one","taskId":"one","paid":true,"usage":{"total_tokens":25}}',
    '{"stage":"terminal","invocationId":"inv-one","taskId":"one","paid":true,"usage":null}',
  ].join("\n");
  assert.throws(() => summarizeLedger(ledger, true), /without trustworthy token usage/);
});

test("separate OS processes cannot exceed the configured global worker slots", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "factory-slot-process-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = runFixture("worker-slot-child.mjs", [root, "one"]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const second = await runFixture("worker-slot-child.mjs", [root, "two"]);
  const firstResult = await first;
  assert.equal(firstResult.code, 0);
  assert.equal(second.code, 1);
  assert.match(second.stderr, /worker slots are occupied/i);
});

test("shared supervisor rejects a child tree that misses the reap deadline", async () => {
  const child = new EventEmitter();
  child.pid = 1234;
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = () => {};
  await assert.rejects(
    superviseProcess({
      command: "fake",
      args: [],
      cwd: ".",
      prompt: "",
      timeoutMs: 5,
      reapDeadlineMs: 10,
      spawnImpl: () => child,
      terminateImpl: () => {},
      signalSource: new EventEmitter(),
    }),
    (error) => error.code === "PROCESS_NOT_REAPED",
  );
});
