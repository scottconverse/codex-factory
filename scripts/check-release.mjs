#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

function git(args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (error) {
    if (options.allowFailure) return null;
    const detail = error.stderr?.trim();
    throw new Error(detail ? `Git failed: ${detail}` : "Git failed while checking release identity");
  }
}

function validateFiles(version) {
  const packageManifest = JSON.parse(read("package.json"));
  const pluginManifest = JSON.parse(read(".codex-plugin/plugin.json"));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`VERSION is not a release version: ${version}`);
  if (packageManifest.version !== version) throw new Error("package.json version disagrees with VERSION");
  if (pluginManifest.version !== version) throw new Error("plugin.json version disagrees with VERSION");

  for (const relative of [
    "README.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "SECURITY.md",
    "docs/USER-MANUAL.md",
    "docs/ARCHITECTURE.md",
    `docs/RELEASE-NOTES-${version}.md`,
    "site/index.html",
    ".github/workflows/pages.yml",
  ]) {
    if (!existsSync(path.join(root, relative))) throw new Error(`Missing release deliverable: ${relative}`);
  }

  const publicText = [
    read("README.md"),
    read("CHANGELOG.md"),
    read("docs/USER-MANUAL.md"),
    read("site/index.html"),
  ].join("\n");

  if (!publicText.includes(version)) throw new Error(`Public documentation omits version ${version}`);
  if (/TODO|FIXME|PLACEHOLDER|lorem ipsum|C:\\Users\\/i.test(publicText)) {
    throw new Error("Public documentation contains a placeholder or private local path");
  }
  if (!publicText.includes("cannot interrupt a single")) {
    throw new Error("Public documentation omits the terminal-only token accounting limitation");
  }
  if (!publicText.includes("process_completed")) {
    throw new Error("Public documentation omits honest process-completion semantics");
  }
}

function validateIdentity(version, mode) {
  const expectedTag = `v${version}`;
  const dirty = git(["status", "--porcelain"]).length > 0;
  const pointedTags = git(["tag", "--points-at", "HEAD"]).split(/\r?\n/).filter(Boolean);

  if (mode === "release") {
    if (dirty) throw new Error("Release candidate is dirty; commit or remove candidate changes before release");
    if (!pointedTags.includes(expectedTag)) {
      throw new Error(`Release candidate HEAD must be exactly ${expectedTag}`);
    }
    return `Release check passed for ${version} at ${expectedTag}`;
  }

  const dirtySuffix = dirty ? "; working tree is dirty" : "";
  if (pointedTags.includes(expectedTag)) {
    return `Development validation passed for ${version}; HEAD is exactly ${expectedTag}${dirtySuffix}`;
  }
  const tagExists = git(["rev-parse", "--verify", "--quiet", `refs/tags/${expectedTag}`], { allowFailure: true });
  if (!tagExists) {
    return `Development validation passed for ${version}; ${expectedTag} does not exist${dirtySuffix}`;
  }
  const isAncestor = git(["merge-base", "--is-ancestor", expectedTag, "HEAD"], { allowFailure: true }) !== null;
  if (isAncestor) {
    const ahead = Number(git(["rev-list", "--count", `${expectedTag}..HEAD`]));
    const noun = ahead === 1 ? "commit" : "commits";
    return `Development validation passed for ${version}; HEAD is ${ahead} ${noun} ahead of ${expectedTag}${dirtySuffix}`;
  }
  return `Development validation passed for ${version}; HEAD is not descended from ${expectedTag}${dirtySuffix}`;
}

function parseMode(args) {
  const known = new Set(["--release", "--development", "--debug"]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
  if (args.includes("--release") && args.includes("--development")) {
    throw new Error("Choose either --release or --development");
  }
  return args.includes("--release") ? "release" : "development";
}

try {
  const mode = parseMode(process.argv.slice(2));
  const version = read("VERSION").trim();
  validateFiles(version);
  process.stdout.write(`${validateIdentity(version, mode)}\n`);
} catch (error) {
  if (process.argv.includes("--debug")) {
    process.stderr.write(`${error.stack ?? error}\n`);
  } else {
    process.stderr.write(`Release check failed: ${error.message}\n`);
  }
  process.exitCode = 1;
}
