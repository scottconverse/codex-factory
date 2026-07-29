#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const htmlPath = path.join(output, "index.html");

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

if (!html.includes("0.1.0")) throw new Error("Landing page version is not 0.1.0");
if (/localhost|lorem ipsum|href=["']#["']/i.test(html)) throw new Error("Landing page contains a placeholder or private URL");

process.stdout.write(`Site check passed: ${files.length} files, ${localReferences.length} local references\n`);
