import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { acquireFileLock } from "./factory-slots.mjs";

export function createInvocationId() {
  return randomUUID();
}

export function summarizeLedger(ledgerText, paid) {
  const latestByInvocation = new Map();
  const legacyPending = new Map();
  let legacySequence = 0;

  const standaloneLegacy = new Set();
  for (const [index, line] of ledgerText.split(/\r?\n/).entries()) {
    if (!line) continue;
    const entry = JSON.parse(line);
    if (entry.paid !== paid) continue;
    let identity = entry.invocationId;
    if (!identity) {
      const key = String(entry.taskId ?? "");
      if (entry.stage === "reserved") {
        identity = `legacy:${key}:${legacySequence += 1}`;
        const pending = legacyPending.get(key) ?? [];
        pending.push(identity);
        legacyPending.set(key, pending);
      } else {
        const pending = legacyPending.get(key) ?? [];
        if (pending.length) {
          identity = pending.shift();
        } else if (!entry.stage && !standaloneLegacy.has(key)) {
          identity = `legacy:${key}:${legacySequence += 1}`;
          standaloneLegacy.add(key);
        } else {
          throw new Error(`Ambiguous legacy usage ledger entry for task ${key || "<missing>"} at line ${index + 1}: terminal record has no matching reservation`);
        }
      }
    }
    latestByInvocation.set(identity, entry);
  }

  const charge = (entry) => {
    if (entry.stage === "reserved") {
      if (!Number.isSafeInteger(entry.reservedTokens)) throw new Error("Usage ledger contains an invalid reservation");
      return entry.reservedTokens;
    }
    if (!Number.isSafeInteger(entry.usage?.total_tokens)) {
      if (paid) throw new Error("Paid usage ledger contains a run without trustworthy token usage");
      return 0;
    }
    return entry.usage.total_tokens;
  };
  return [...latestByInvocation.values()].reduce((total, entry) => total + charge(entry), 0);
}

export async function reserveUnpaidTaskUsage({ stateRoot, taskId, metadata = {} }) {
  const ledgerPath = path.join(stateRoot, "usage.jsonl");
  const lock = await acquireFileLock(path.join(stateRoot, "usage.lock"), { taskId, stage: "reserved", paid: false });
  try {
    const ledgerText = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    if (ledgerText.split(/\r?\n/).filter(Boolean).some((line) => JSON.parse(line).taskId === taskId)) {
      throw new Error(`Task ${taskId} already has an attempt`);
    }
    const invocationId = createInvocationId();
    const record = {
      stage: "reserved",
      invocationId,
      taskId,
      paid: false,
      reservedTokens: null,
      startedAt: new Date().toISOString(),
      ...metadata,
    };
    appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`);
    return { invocationId, ledgerPath, record };
  } finally {
    lock.release();
  }
}

export function usageSpent(ledgerPath, paid = true) {
  return existsSync(ledgerPath) ? summarizeLedger(readFileSync(ledgerPath, "utf8"), paid) : 0;
}

export async function reservePaidUsage({
  stateRoot,
  aggregateLimit,
  reservedTokens,
  taskId,
  metadata = {},
  rejectTaskReuse = false,
}) {
  if (!Number.isSafeInteger(reservedTokens) || reservedTokens <= 0) {
    throw new Error("Paid invocation requires a positive token reservation");
  }
  const ledgerPath = path.join(stateRoot, "usage.jsonl");
  const lock = await acquireFileLock(path.join(stateRoot, "usage.lock"), { taskId, stage: "reserved" });
  try {
    const ledgerText = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    if (rejectTaskReuse && ledgerText.split(/\r?\n/).filter(Boolean)
      .some((line) => JSON.parse(line).taskId === taskId)) {
      throw new Error(`Task ${taskId} already has an attempt`);
    }
    const spent = summarizeLedger(ledgerText, true);
    const remaining = aggregateLimit - spent;
    if (reservedTokens > remaining) {
      throw new Error(`Reservation ${reservedTokens} exceeds remaining budget ${remaining}`);
    }
    const invocationId = createInvocationId();
    const record = {
      stage: "reserved",
      invocationId,
      taskId,
      paid: true,
      reservedTokens,
      startedAt: new Date().toISOString(),
      ...metadata,
    };
    appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`);
    return { invocationId, ledgerPath, spent, remaining, record };
  } finally {
    lock.release();
  }
}

export async function reconcilePaidUsage({ stateRoot, invocationId, taskId, usage, metadata = {} }) {
  const ledgerPath = path.join(stateRoot, "usage.jsonl");
  const lock = await acquireFileLock(path.join(stateRoot, "usage.lock"), { taskId, invocationId, stage: "terminal" });
  try {
    const record = {
      stage: "terminal",
      invocationId,
      taskId,
      paid: true,
      usage,
      finishedAt: new Date().toISOString(),
      ...metadata,
    };
    appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`);
    return record;
  } finally {
    lock.release();
  }
}
