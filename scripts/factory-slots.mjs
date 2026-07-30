import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function claim(pathname, metadata) {
  let descriptor;
  try {
    descriptor = openSync(pathname, "wx");
    writeFileSync(descriptor, `${JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      ...metadata,
    })}\n`);
  } catch (error) {
    if (descriptor !== undefined) {
      closeSync(descriptor);
      rmSync(pathname, { force: true });
    }
    throw error;
  }
  closeSync(descriptor);
  let owned = true;
  return {
    path: pathname,
    quarantine(metadata = {}) {
      if (!owned) return;
      writeFileSync(pathname, `${JSON.stringify({ pid: process.pid, quarantined: true, quarantinedAt: new Date().toISOString(), ...metadata })}\n`);
    },
    release() {
      if (!owned) return;
      owned = false;
      rmSync(pathname, { force: true });
    },
  };
}

function reclaimDeadClaim(pathname) {
  let owner;
  try {
    owner = JSON.parse(readFileSync(pathname, "utf8"));
  } catch {
    return false;
  }
  const ownedPid = owner.quarantined === true ? owner.childPid : owner.pid;
  if (!Number.isSafeInteger(ownedPid) || ownedPid < 1) return false;
  try {
    process.kill(ownedPid, 0);
    return false;
  } catch (error) {
    if (error.code !== "ESRCH") return false;
  }
  rmSync(pathname, { force: true });
  return true;
}

export function isContendedClaim(
  error,
  pathname,
  platform = process.platform,
  { boundedFileLock = false } = {},
) {
  return error.code === "EEXIST"
    || (platform === "win32" && error.code === "EPERM" && (boundedFileLock || existsSync(pathname)));
}

export function acquireWorkerSlot(stateRoot, maximum, metadata = {}) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 4) {
    throw new Error("Worker slot maximum must be between 1 and 4");
  }
  const slotRoot = path.resolve(stateRoot, "worker-slots");
  mkdirSync(slotRoot, { recursive: true });
  for (let index = 1; index <= maximum; index += 1) {
    try {
      return claim(path.join(slotRoot, `${index}.lock`), { slot: index, ...metadata });
    } catch (error) {
      if (!isContendedClaim(error, path.join(slotRoot, `${index}.lock`))) throw error;
      if (reclaimDeadClaim(path.join(slotRoot, `${index}.lock`))) {
        return claim(path.join(slotRoot, `${index}.lock`), { slot: index, ...metadata });
      }
    }
  }
  throw new Error(`All ${maximum} worker slots are occupied`);
}

export async function acquireFileLock(pathname, metadata = {}, { timeoutMs = 5_000, retryMs = 25 } = {}) {
  const resolved = path.resolve(pathname);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      return claim(resolved, metadata);
    } catch (error) {
      if (!isContendedClaim(error, resolved, process.platform, { boundedFileLock: true })) throw error;
      if (reclaimDeadClaim(resolved)) continue;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for lock ${resolved}`);
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
}
