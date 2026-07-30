import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function createTemporaryRoot(context, prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  }));
  return root;
}
