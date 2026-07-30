#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCliArgs, printHelp, reportCliError } from "./factory-cli.mjs";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = `Usage:
  node scripts/coordinator-intake.mjs (--prompt-file <file> | --prompt <text>)
    (--repository <directory> | --bootstrap <new-directory>)
    [--campaign-id <id>] [--base <revision>]

Options:
  --prompt-file <file>       Read the owner prompt or specification from a file.
  --prompt <text>            Use an owner prompt directly.
  --repository <directory>  Use an existing clean Git worktree.
  --bootstrap <directory>   DANGEROUS: create and initialize a new repository.
  --campaign-id <id>        Set the generated campaign identifier.
  --base <revision>          Set the campaign base revision (default: HEAD).
  -h, --help                 Show this help.`;

function git(args, cwd, options = {}) {
  const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`.trim());
  }
  return result;
}

function isGitRepository(repository) {
  const result = git(["rev-parse", "--is-inside-work-tree"], repository, { allowFailure: true });
  return result.status === 0 && result.stdout.trim() === "true";
}

function gitRoot(repository) {
  const result = git(["rev-parse", "--show-toplevel"], repository);
  return path.resolve(result.stdout.trim());
}

function hasTrackedChanges(repository) {
  return git(["diff", "--quiet"], repository, { allowFailure: true }).status !== 0
    || git(["diff", "--cached", "--quiet"], repository, { allowFailure: true }).status !== 0;
}

function ensureFactoryIgnored(repository) {
  const gitDir = path.resolve(repository, git(["rev-parse", "--absolute-git-dir"], repository).stdout.trim());
  const infoDir = path.join(gitDir, "info");
  if (!existsSync(infoDir)) mkdirSync(infoDir, { recursive: true });
  if (lstatSync(infoDir).isSymbolicLink()) throw new Error("Git metadata info directory uses a symbolic link");
  const ignoreFile = path.join(infoDir, "exclude");
  if (existsSync(ignoreFile)) {
    const details = lstatSync(ignoreFile);
    if (details.isSymbolicLink() || details.nlink > 1) {
      throw new Error("Git metadata exclude file is linked outside its Git metadata path");
    }
  }
  const current = existsSync(ignoreFile) ? readFileSync(ignoreFile, "utf8") : "";
  if (current.split(/\r?\n/).includes(".codex-factory/")) return;
  writeFileSync(ignoreFile, `${current}${current && !current.endsWith("\n") ? "\n" : ""}.codex-factory/\n`);
}

function ensurePrivateRunPath(repository, id) {
  const root = realpathSync(repository);
  const prefix = `${root}${path.sep}`.toLowerCase();
  let current = root;
  for (const component of [".codex-factory", "coordinator", id]) {
    current = path.join(current, component);
    if (!existsSync(current)) mkdirSync(current);
    const details = lstatSync(current);
    if (details.isSymbolicLink()) throw new Error(`Coordinator state path uses a symbolic link: ${component}`);
    const resolved = realpathSync(current);
    if (!resolved.toLowerCase().startsWith(prefix)) throw new Error("Coordinator state path escapes the repository");
  }
  return current;
}

function writePrivateRunFile(repository, id, filename, contents) {
  const runPath = ensurePrivateRunPath(repository, id);
  const destination = path.join(runPath, filename);
  writeFileSync(destination, contents, { flag: "wx" });
  if (realpathSync(path.dirname(destination)) !== realpathSync(runPath)) {
    throw new Error("Coordinator state path changed while writing private intake");
  }
  return destination;
}

function generatedCampaignId(prompt) {
  const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
  return `coord-${hash}-${Date.now().toString(36)}`;
}

function requirePrompt(prompt) {
  if (typeof prompt !== "string" || prompt.trim().length < 10) {
    throw new Error("Coordinator prompt must contain an actionable prompt or specification");
  }
  return `${prompt.trim()}\n`;
}

export function bootstrapRepository(target) {
  const repository = path.resolve(target);
  if (existsSync(repository)) {
    if (!lstatSync(repository).isDirectory()) throw new Error("Bootstrap target must be a directory path");
    if (isGitRepository(repository)) throw new Error("Bootstrap target is already a Git repository");
    throw new Error("Bootstrap target must not already exist to avoid replacing owner directories");
  }
  const staging = path.join(path.dirname(repository), `.${path.basename(repository)}.codex-factory-bootstrap-${randomBytes(12).toString("hex")}`);
  mkdirSync(staging);
  try {
    git(["init"], staging);
    ensureFactoryIgnored(staging);
    git([
      "-c", "user.name=Codex Factory",
      "-c", "user.email=codex-factory@local",
      "commit", "--allow-empty", "-m", "chore: initialize repository",
    ], staging);
    mkdirSync(repository);
    renameSync(path.join(staging, ".git"), path.join(repository, ".git"));
    rmdirSync(staging);
    return repository;
  } catch (error) {
    throw new Error(`Bootstrap did not replace the target; inspect ${repository} and retained staging directory ${staging}: ${error.message}`);
  }
}

export function createCoordinatorIntake({ repository: target, promptFile, prompt, campaignId, base = "HEAD" }) {
  const requestedRepository = path.resolve(target);
  if (!isGitRepository(requestedRepository)) throw new Error("Coordinator repository must be an existing non-bare Git worktree; use --bootstrap for a new project");
  const repository = gitRoot(requestedRepository);
  if (hasTrackedChanges(repository)) throw new Error("Coordinator repository has tracked owner changes; commit them or use a clean worktree before starting a campaign");
  const source = requirePrompt(prompt);
  const id = campaignId ?? generatedCampaignId(source);
  if (!ID_PATTERN.test(id)) throw new Error("Coordinator campaign ID is invalid");
  if (typeof base !== "string" || !base || /[\r\n]/.test(base)) throw new Error("Coordinator base is required");

  const repositoryHash = createHash("sha256").update(realpathSync(repository)).digest("hex").slice(0, 12);
  const privateId = `${repositoryHash}-${id}`;
  const runPath = path.join(ROOT, ".codex-factory", "coordinator", privateId);
  if (existsSync(runPath)) throw new Error(`Coordinator run already exists: ${id}`);
  ensurePrivateRunPath(ROOT, privateId);
  const sourcePath = path.join(runPath, "source.md");
  const planFile = path.join(runPath, "campaign.json");
  const intake = {
    version: 1,
    campaignId: id,
    repository,
    base,
    promptFile: promptFile ? path.resolve(promptFile) : null,
    sourcePath,
    planFile,
    planningOwner: "primary-codex-session",
    ownerSuppliedPlan: false,
  };
  writePrivateRunFile(ROOT, privateId, "source.md", source);
  writePrivateRunFile(ROOT, privateId, "intake.json", `${JSON.stringify(intake, null, 2)}\n`);
  return intake;
}

function parseArgs(argv) {
  const options = parseCliArgs(argv, { valueFlags: {
    "--prompt-file": "prompt_file",
    "--prompt": "prompt",
    "--repository": "repository",
    "--bootstrap": "bootstrap",
    "--campaign-id": "campaign_id",
    "--base": "base",
  } });
  if (options.help) return options;
  if (Boolean(options.prompt_file) === Boolean(options.prompt)) throw new Error("Provide exactly one of --prompt-file or --prompt");
  if (Boolean(options.repository) === Boolean(options.bootstrap)) {
    throw new Error("Provide exactly one of --repository or --bootstrap");
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp(USAGE);
    return null;
  }
  const promptFile = options.prompt_file ? path.resolve(options.prompt_file) : null;
  if (promptFile && (!existsSync(promptFile) || !lstatSync(promptFile).isFile())) throw new Error("--prompt-file must name a regular file");
  const repository = options.bootstrap ? bootstrapRepository(options.bootstrap) : path.resolve(options.repository);
  const intake = createCoordinatorIntake({
    repository,
    promptFile,
    prompt: promptFile ? readFileSync(promptFile, "utf8") : options.prompt,
    campaignId: options.campaign_id,
    base: options.base ?? "HEAD",
  });
  process.stdout.write(`${JSON.stringify(intake, null, 2)}\n`);
  return intake;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(reportCliError);
}
