#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = Object.freeze({
  "run-worker.mjs": { lines: 83, functions: 75 },
  "qualify-fleet.mjs": { lines: 85, functions: 84 },
  "fleet-smoke.mjs": { lines: 88, functions: 92 },
  "run-local-patch.mjs": { lines: 77, functions: 78 },
});

function matchingScripts(profiles, filename, allowedUrls) {
  return profiles.flatMap((profile) => profile.result ?? []).filter((script) => {
    return allowedUrls.has(script.url);
  });
}

function effectiveCount(functions, position) {
  let selected = null;
  for (const fn of functions) {
    for (const range of fn.ranges ?? []) {
      if (range.startOffset <= position && position < range.endOffset) {
        const length = range.endOffset - range.startOffset;
        if (!selected || length < selected.length) selected = { length, count: range.count };
      }
    }
  }
  return selected?.count ?? 0;
}

export function analyzeSubprocessCoverage({ profiles, filename, source, allowedSources }) {
  const expectedDigest = createHash("sha256").update(source).digest("hex");
  const allowedUrls = new Set(
    allowedSources
      .filter((entry) => entry.filename === filename && entry.digest === expectedDigest)
      .map((entry) => entry.url),
  );
  if (!allowedUrls.size) throw new Error(`No source-authenticated subprocess manifest entries for scripts/${filename}`);
  const scripts = matchingScripts(profiles, filename, allowedUrls);
  if (!scripts.length) throw new Error(`No subprocess coverage found for scripts/${filename}`);
  const coveredPositions = new Uint8Array(source.length);
  const functions = new Map();
  for (const script of scripts) {
    for (let position = 0; position < source.length; position += 1) {
      if (!coveredPositions[position] && effectiveCount(script.functions ?? [], position) > 0) {
        coveredPositions[position] = 1;
      }
    }
    for (const fn of script.functions ?? []) {
      const primary = fn.ranges?.[0];
      if (!primary) continue;
      if (!fn.functionName && primary.startOffset === 0 && primary.endOffset >= source.length) continue;
      const key = `${fn.functionName}\0${primary.startOffset}\0${primary.endOffset}`;
      functions.set(key, (functions.get(key) ?? false) || primary.count > 0);
    }
  }

  let lineStart = 0;
  let totalLines = 0;
  let coveredLines = 0;
  for (const line of source.split("\n")) {
    const positions = [];
    for (let index = 0; index < line.length; index += 1) {
      if (!/\s/.test(line[index])) positions.push(lineStart + index);
    }
    if (positions.length) {
      totalLines += 1;
      if (positions.some((position) => coveredPositions[position])) coveredLines += 1;
    }
    lineStart += line.length + 1;
  }
  const coveredFunctions = [...functions.values()].filter(Boolean).length;
  const totalFunctions = functions.size;
  return {
    lines: totalLines ? coveredLines / totalLines * 100 : 100,
    functions: totalFunctions ? coveredFunctions / totalFunctions * 100 : 100,
    coveredLines,
    totalLines,
    coveredFunctions,
    totalFunctions,
    processEntries: scripts.length,
  };
}

export function enforceThresholds(metrics, thresholds, filename) {
  for (const metric of ["lines", "functions"]) {
    if (metrics[metric] + Number.EPSILON < thresholds[metric]) {
      throw new Error(
        `Subprocess ${filename} ${metric} coverage ${metrics[metric].toFixed(2)}% is below ${thresholds[metric]}%`,
      );
    }
  }
}

export function main() {
  const coverageRoot = mkdtempSync(path.join(os.tmpdir(), "codex-factory-v8-coverage-"));
  const manifestPath = path.join(coverageRoot, "source-manifest.jsonl");
  const allowedSources = [];
  try {
    const result = spawnSync(process.execPath, [
      "--test",
      "test/executable-boundaries.test.mjs",
    ], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_V8_COVERAGE: coverageRoot,
        CODEX_FACTORY_COVERAGE_MANIFEST: manifestPath,
      },
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Executable-boundary test exited ${result.status}`);
    const profiles = readdirSync(coverageRoot)
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(readFileSync(path.join(coverageRoot, name), "utf8")));
    allowedSources.push(
      ...readFileSync(manifestPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)),
    );
    for (const [filename, thresholds] of Object.entries(TARGETS)) {
      const source = readFileSync(path.join(ROOT, "scripts", filename), "utf8");
      const metrics = analyzeSubprocessCoverage({ profiles, filename, source, allowedSources });
      enforceThresholds(metrics, thresholds, filename);
      process.stdout.write(
        `subprocess coverage ${filename}: lines ${metrics.lines.toFixed(2)}% `
        + `(${metrics.coveredLines}/${metrics.totalLines}), functions ${metrics.functions.toFixed(2)}% `
        + `(${metrics.coveredFunctions}/${metrics.totalFunctions}), profiles ${metrics.processEntries}\n`,
      );
    }
  } finally {
    rmSync(coverageRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
