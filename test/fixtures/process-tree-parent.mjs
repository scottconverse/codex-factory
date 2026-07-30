import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

appendFileSync(process.argv[2], `${JSON.stringify({ role: "parent", pid: process.pid })}\n`);
spawn(process.execPath, [path.join(import.meta.dirname, "process-tree-grandchild.mjs"), process.argv[2]], {
  stdio: "ignore",
  windowsHide: true,
});
setInterval(() => {}, 1_000);
