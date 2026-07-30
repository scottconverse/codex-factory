import { acquireWorkerSlot } from "../../scripts/factory-slots.mjs";

const [stateRoot, taskId] = process.argv.slice(2);
try {
  const slot = acquireWorkerSlot(stateRoot, 1, { taskId });
  process.stdout.write("acquired\n");
  setTimeout(() => {
    slot.release();
    process.exit(0);
  }, 150);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
