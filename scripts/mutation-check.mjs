#!/usr/bin/env node
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const focusedCommand = ["--test", "test/mutation-seams.test.mjs"];
process.stdout.write(`Focused command: ${process.execPath} ${focusedCommand.join(" ")}\n`);

function runFocused(cwd) {
  return spawnSync(process.execPath, focusedCommand, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

function copyFixture() {
  const fixture = mkdtempSync(path.join(tmpdir(), "codex-factory-mutation-"));
  cpSync(path.join(root, "scripts"), path.join(fixture, "scripts"), {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}.codex-factory${path.sep}`),
  });
  cpSync(path.join(root, "test", "mutation-seams.test.mjs"), path.join(fixture, "test", "mutation-seams.test.mjs"), {
    recursive: true,
  });
  return fixture;
}

function replaceExactly(source, before, after, mutantName) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${mutantName}: expected one stable mutation seam, found ${occurrences}`);
  }
  return source.replace(before, after);
}

const mutants = [
  {
    name: "paid-ledger-drops-terminal-usage",
    file: "scripts/factory-admission.mjs",
    before: "return [...latestByInvocation.values()].reduce((total, entry) => total + charge(entry), 0);",
    after: "return [...latestByInvocation.values()].reduce((total, entry) => total, 0);",
  },
  {
    name: "paid-admission-lock-is-nonexclusive",
    file: "scripts/factory-slots.mjs",
    before: "      return claim(resolved, metadata);",
    after: "      return { path: resolved, release() {} };",
  },
];

const baseline = runFocused(root);
if (baseline.status !== 0) {
  process.stderr.write("Mutation baseline must pass before mutants can be evaluated.\n");
  process.stderr.write(baseline.stdout);
  process.stderr.write(baseline.stderr);
  process.exit(1);
}

for (const mutant of mutants) {
  const fixture = copyFixture();
  try {
    const filename = path.join(fixture, mutant.file);
    const source = readFileSync(filename, "utf8");
    writeFileSync(filename, replaceExactly(source, mutant.before, mutant.after, mutant.name));
    const result = runFocused(fixture);
    const output = `${result.stdout}${result.stderr}`;
    if (result.status === 0) {
      throw new Error(`${mutant.name}: survived ${process.execPath} ${focusedCommand.join(" ")}\n${output}`);
    }
    if (!/AssertionError/.test(output)) {
      throw new Error(`${mutant.name}: test process failed without a meaningful assertion\n${output}`);
    }
    process.stdout.write(`KILLED ${mutant.name}\n`);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

process.stdout.write(`Mutation score: ${mutants.length}/${mutants.length} known Critical mutants killed\n`);
