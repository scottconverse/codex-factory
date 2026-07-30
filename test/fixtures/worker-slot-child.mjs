import { acquireWorkerSlot } from "../../scripts/factory-slots.mjs";
import { existsSync, writeFileSync } from "node:fs";

const [stateRoot, taskId, readyPath, releasePath] = process.argv.slice(2);
try {
  const slot = acquireWorkerSlot(stateRoot, 1, { taskId });
  process.stdout.write("acquired\n");
  if (!readyPath || !releasePath) {
    slot.release();
    process.exit(0);
  }
  writeFileSync(readyPath, "");
  const releasePoll = setInterval(() => {
    if (!existsSync(releasePath)) return;
    clearInterval(releasePoll);
    slot.release();
    process.exit(0);
  }, 5);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
