import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquireFileLock } from "../scripts/factory-slots.mjs";
import { summarizeLedger } from "../scripts/run-worker.mjs";

test("paid ledger aggregation retains every completed legacy attempt", () => {
  const ledger = [
    '{"stage":"reserved","taskId":"reused","paid":true,"reservedTokens":100}',
    '{"stage":"terminal","taskId":"reused","paid":true,"usage":{"total_tokens":25}}',
    '{"stage":"reserved","taskId":"reused","paid":true,"reservedTokens":100}',
    '{"stage":"terminal","taskId":"reused","paid":true,"usage":{"total_tokens":30}}',
  ].join("\n");

  assert.equal(summarizeLedger(ledger, true), 55);
});

test("paid admission lock remains exclusive until its owner releases it", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "factory-mutation-lock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lockPath = path.join(root, "usage.lock");
  const owner = await acquireFileLock(lockPath, { taskId: "owner" }, { timeoutMs: 500, retryMs: 5 });
  let contenderAcquired = false;
  const contenderPromise = acquireFileLock(
    lockPath,
    { taskId: "contender" },
    { timeoutMs: 500, retryMs: 5 },
  ).then((lock) => {
    contenderAcquired = true;
    return lock;
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(contenderAcquired, false, "a second paid admission entered the locked section");
  owner.release();
  const contender = await contenderPromise;
  assert.equal(contender.path, lockPath);
  contender.release();
});
