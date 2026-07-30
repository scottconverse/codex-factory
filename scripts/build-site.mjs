#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "site");
const output = path.join(root, "dist");

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(source, output, { recursive: true });

const version = readFileSync(path.join(root, "VERSION"), "utf8").trim();
const socialCardPath = path.join(output, "social-card.svg");
const socialCard = readFileSync(socialCardPath, "utf8");
const synchronizedSocialCard = socialCard.replace(/\bv?\d+\.\d+\.\d+\b/g, (found) => (
  found.startsWith("v") ? `v${version}` : version
));
writeFileSync(socialCardPath, synchronizedSocialCard);

process.stdout.write(`Built ${output}\n`);
