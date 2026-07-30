#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const htmlPath = path.join(output, "index.html");

function checkSite() {
  if (!existsSync(htmlPath)) throw new Error("Run npm run site:build before site:check");

  const html = readFileSync(htmlPath, "utf8");
  const requiredAnchors = ["main", "top", "controls", "workflow", "quick-start", "status"];
  for (const id of requiredAnchors) {
    if (!new RegExp(`\\bid=["']${id}["']`).test(html)) throw new Error(`Missing required anchor: ${id}`);
  }

  const localReferences = [...html.matchAll(/(?:href|src)=["']([^"'#][^"']*)["']/g)]
    .map((match) => match[1])
    .filter((reference) => !/^(?:https?:|mailto:|data:)/.test(reference));

  for (const reference of localReferences) {
    const target = path.join(output, reference.split(/[?#]/)[0]);
    if (!existsSync(target)) throw new Error(`Broken local reference: ${reference}`);
  }

  for (const anchor of [...html.matchAll(/href=["']#([^"']+)["']/g)].map((match) => match[1])) {
    if (!new RegExp(`\\bid=["']${anchor}["']`).test(html)) throw new Error(`Broken page anchor: #${anchor}`);
  }

  const files = readdirSync(output).filter((name) => statSync(path.join(output, name)).isFile());
  for (const required of ["index.html", "styles.css", "app.js", "mark.svg", "social-card.svg"]) {
    if (!files.includes(required)) throw new Error(`Missing built asset: ${required}`);
  }

  const version = readFileSync(path.join(root, "VERSION"), "utf8").trim();
  if (!html.includes(version)) throw new Error(`Landing page version is not ${version}`);
  if (/localhost|lorem ipsum|href=["']#["']/i.test(html)) throw new Error("Landing page contains a placeholder or private URL");

  const socialCard = readFileSync(path.join(output, "social-card.svg"), "utf8");
  const cardVersions = [...socialCard.matchAll(/\bv?(\d+\.\d+\.\d+)\b/g)].map((match) => match[1]);
  const staleVersion = cardVersions.find((candidate) => candidate !== version);
  if (staleVersion) {
    throw new Error(`social-card.svg advertises ${staleVersion}, expected ${version}`);
  }

  process.stdout.write(`Site check passed: ${files.length} files, ${localReferences.length} local references\n`);
}

try {
  checkSite();
} catch (error) {
  if (process.argv.includes("--debug")) {
    process.stderr.write(`${error.stack ?? error}\n`);
  } else {
    process.stderr.write(`Site check failed: ${error.message}\n`);
  }
  process.exitCode = 1;
}
