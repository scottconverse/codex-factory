import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function createTemporaryRoot(context, prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => removeTemporaryRoot(root));
  return root;
}

export function removeTemporaryRoot(root) {
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
}
