import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquireFileLock, acquireWorkerSlot } from "../scripts/factory-slots.mjs";

test("worker slots enforce the configured campaign-wide concurrency", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "factory-slots-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = acquireWorkerSlot(root, 2, { taskId: "one" });
  const second = acquireWorkerSlot(root, 2, { taskId: "two" });
  assert.notEqual(first.path, second.path);
  assert.throws(() => acquireWorkerSlot(root, 2, { taskId: "three" }), /worker slots are occupied/i);
  first.release();
  const third = acquireWorkerSlot(root, 2, { taskId: "three" });
  third.release();
  second.release();
});

test("exclusive ledger locks wait briefly instead of racing reservations", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "factory-lock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lockPath = path.join(root, "ledger.lock");
  const first = await acquireFileLock(lockPath, { taskId: "one" }, { timeoutMs: 100 });
  const waiting = acquireFileLock(lockPath, { taskId: "two" }, { timeoutMs: 200, retryMs: 5 });
  setTimeout(() => first.release(), 20);
  const second = await waiting;
  assert.equal(second.path, lockPath);
  second.release();
});

test("worker slots reclaim a lock owned by a dead process", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "factory-stale-slot-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const slotRoot = path.join(root, "worker-slots");
  mkdirSync(slotRoot);
  writeFileSync(path.join(slotRoot, "1.lock"), `${JSON.stringify({ pid: 2_147_483_647, taskId: "interrupted" })}\n`);
  const recovered = acquireWorkerSlot(root, 1, { taskId: "replacement" });
  recovered.release();
});
