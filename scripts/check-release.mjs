#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const version = read("VERSION").trim();
const packageManifest = JSON.parse(read("package.json"));
const pluginManifest = JSON.parse(read(".codex-plugin/plugin.json"));

if (!/^0\.1\.3$/.test(version)) throw new Error(`Expected release version 0.1.3, found ${version}`);
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

process.stdout.write(`Release check passed for ${version}\n`);
