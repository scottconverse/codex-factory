import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
for (const filename of ["run-worker.mjs", "qualify-fleet.mjs", "fleet-smoke.mjs"]) {
  const source = readFileSync(path.join(root, "scripts", filename), "utf8");
  assert.match(
    source,
    /const admission = await reservePaidUsage\(\{/,
    `${filename} must invoke shared paid admission before launching Codex`,
  );
  assert.match(
    source,
    /await reconcilePaidUsage\(\{/,
    `${filename} must reconcile shared paid usage after launching Codex`,
  );
}
