import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { summarizeLedger } from "../scripts/factory-admission.mjs";
import { superviseProcess } from "../scripts/factory-process.mjs";
import { isContendedClaim } from "../scripts/factory-slots.mjs";

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

function waitForFile(filename, timeoutMs = 2_000) {
  if (existsSync(filename)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const watcher = watch(path.dirname(filename), () => {
      if (!existsSync(filename)) return;
      clearTimeout(timeout);
      watcher.close();
      resolve();
    });
    const timeout = setTimeout(() => {
      watcher.close();
      reject(new assert.AssertionError({
        message: `fixture did not create handshake file ${filename}`,
      }));
    }, timeoutMs);
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

test("Windows delete-pending EPERM remains lock contention", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "factory-eperm-lock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lockPath = path.join(root, "usage.lock");
  writeFileSync(lockPath, "{}");
  assert.equal(isContendedClaim({ code: "EPERM" }, lockPath, "win32"), true);
  assert.equal(isContendedClaim({ code: "EPERM" }, path.join(root, "missing.lock"), "win32"), false);
  assert.equal(isContendedClaim({ code: "EPERM" }, lockPath, "linux"), false);
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
  const ready = path.join(root, "first-ready");
  const release = path.join(root, "release-first");
  const first = runFixture("worker-slot-child.mjs", [root, "one", ready, release]);
  await waitForFile(ready);
  let second;
  try {
    second = await runFixture("worker-slot-child.mjs", [root, "two"]);
  } finally {
    writeFileSync(release, "");
  }
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

test("shared supervisor terminates and reaps a real child after timeout", async () => {
  let result;
  const startedAt = Date.now();
  await assert.doesNotReject(async () => {
    result = await superviseProcess({
      command: process.execPath,
      args: [path.join(import.meta.dirname, "fixtures", "long-running-child.mjs")],
      cwd: import.meta.dirname,
      prompt: "",
      timeoutMs: 25,
      reapDeadlineMs: 2_000,
    });
  });
  assert.ok(Date.now() - startedAt < 500, "timeout must actively terminate the child, not wait for its natural exit");
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, null, "timed-out child must be reaped before supervision resolves");
});
