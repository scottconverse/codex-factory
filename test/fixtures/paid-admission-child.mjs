import { reservePaidUsage } from "../../scripts/factory-admission.mjs";

const [stateRoot, taskId] = process.argv.slice(2);
try {
  const result = await reservePaidUsage({
    stateRoot,
    aggregateLimit: 100,
    reservedTokens: 60,
    taskId,
  });
  process.stdout.write(`${result.invocationId}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
