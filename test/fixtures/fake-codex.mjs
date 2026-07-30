import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

if (process.argv.includes("--version")) {
  process.stdout.write("fake-codex 1.0.0\n");
  process.exit(0);
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const stateRoot = process.env.CODEX_FACTORY_TEST_STATE_ROOT;
const markerPath = process.env.CODEX_FACTORY_TEST_MARKER;
if (!stateRoot || !markerPath) throw new Error("fake Codex requires isolated test state paths");

const outputPath = argumentValue("--output-last-message");
const ledgerPath = path.join(stateRoot, "usage.jsonl");
const ledger = existsSync(ledgerPath)
  ? readFileSync(ledgerPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  : [];
const terminalIds = new Set(ledger.filter(({ stage }) => stage === "terminal").map(({ invocationId }) => invocationId));
const pending = ledger.filter(({ stage, invocationId }) => stage === "reserved" && !terminalIds.has(invocationId));
const smokeTask = outputPath.includes(`${path.sep}fleet-smoke${path.sep}`)
  ? `fleet-smoke-${path.basename(path.dirname(outputPath))}`
  : null;
const reservation = smokeTask
  ? pending.find(({ taskId }) => taskId === smokeTask)
  : pending.at(-1);
if (!reservation || reservation.paid !== true) {
  throw new Error("fake Codex started before a durable paid reservation");
}
appendFileSync(markerPath, `${JSON.stringify({
  event: "started",
  pid: process.pid,
  invocationId: reservation.invocationId,
  taskId: reservation.taskId,
  ledgerLength: ledger.length,
})}\n`);

if (process.env.CODEX_FACTORY_TEST_FAKE_MODE === "nonzero") {
  process.stderr.write("deterministic fake failure\n");
  process.exit(23);
}

const worktree = argumentValue("-C");
const input = await new Promise((resolve) => {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { text += chunk; });
  process.stdin.on("end", () => resolve(text));
});

let message;
if (input.includes("CODEX_FACTORY_ANALYSIS_QUALIFIED")) {
  message = "CODEX_FACTORY_ANALYSIS_QUALIFIED";
} else if (input.includes("60 mm") && input.includes("holeCount")) {
  message = '{"valid":false,"reason":"60 mm exceeds 40 mm","holeCount":4}';
} else if (input.includes("src/value.mjs")) {
  writeFileSync(path.join(worktree, "src", "value.mjs"), "export const value = 42;\n");
  message = "wrote exact qualification fixture";
} else if (input.includes('Set task to "package"')) {
  const pkg = JSON.parse(readFileSync(path.join(worktree, "package.json"), "utf8"));
  message = JSON.stringify({ task: "package", name: pkg.name, version: pkg.version });
} else if (input.includes('Set task to "config"')) {
  const config = JSON.parse(readFileSync(path.join(worktree, "factory.config.json"), "utf8"));
  message = JSON.stringify({
    task: "config",
    maxConcurrentWorkers: config.budgets.maxConcurrentWorkers,
    discoverOllama: config.candidates.ollama.discover,
    configuredCodexCandidates: config.candidates.openai.length,
  });
} else if (input.includes("src/result.txt")) {
  writeFileSync(path.join(worktree, "src", "result.txt"), "built by executable worker\n");
  message = "created the bounded campaign artifact";
} else {
  message = "deterministic fake completed";
}

if (process.env.CODEX_FACTORY_TEST_FAKE_MODE === "malformed") {
  process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":"bad","output_tokens":2}}\n');
} else {
  process.stdout.write('{"type":"turn.completed","usage":{"input_tokens":11,"output_tokens":7}}\n');
}
writeFileSync(outputPath, `${message}\n`);
