import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { bootstrapRepository, createCoordinatorIntake } from "../scripts/coordinator-intake.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("createCoordinatorIntake copies an owner prompt into an existing repository and reserves an internal plan path", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-factory-intake-"));
  const promptFile = path.join(root, "owner-spec.md");
  const repository = path.join(root, "repository");
  bootstrapRepository(repository);
  const intake = createCoordinatorIntake({
    repository,
    promptFile,
    prompt: "Build a small command line tool with tests.",
    campaignId: "build-cli",
    base: "HEAD",
  });

  assert.equal(intake.campaignId, "build-cli");
  assert.equal(intake.repository, repository);
  assert.equal(intake.base, "HEAD");
  assert.match(intake.sourcePath, /\.codex-factory[\\/]coordinator[\\/]\w+-build-cli[\\/]source\.md$/);
  assert.match(intake.planFile, /\.codex-factory[\\/]coordinator[\\/]\w+-build-cli[\\/]campaign\.json$/);
  assert.equal(readFileSync(intake.sourcePath, "utf8"), "Build a small command line tool with tests.\n");
  assert.equal(existsSync(path.join(repository, ".gitignore")), false);
  assert.equal(spawnSync("git", ["status", "--short"], { cwd: repository, encoding: "utf8" }).stdout, "");
});

test("createCoordinatorIntake accepts a direct coordinator prompt without making the owner create a file", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-factory-direct-"));
  const repository = path.join(root, "repository");
  bootstrapRepository(repository);
  const intake = createCoordinatorIntake({
    repository,
    prompt: "Add a documented health-check command to this project.",
    campaignId: "health-check",
  });

  assert.equal(intake.promptFile, null);
  assert.equal(readFileSync(intake.sourcePath, "utf8"), "Add a documented health-check command to this project.\n");
});

test("coordinator intake CLI bootstraps a new repository from an owner prompt without requiring a JSON plan", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "codex-factory-cli-"));
  const repository = path.join(parent, "new-product");
  const result = spawnSync(process.execPath, [
    "scripts/coordinator-intake.mjs",
    "--bootstrap", repository,
    "--campaign-id", "cli-product",
    "--prompt", "Build a small command-line timer with a test suite.",
  ], { cwd: ROOT, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  const intake = JSON.parse(result.stdout);
  assert.equal(intake.ownerSuppliedPlan, false);
  assert.equal(intake.planningOwner, "primary-codex-session");
  assert.equal(existsSync(intake.sourcePath), true);
  assert.equal(existsSync(intake.planFile), false);
});

test("createCoordinatorIntake normalizes a repository subdirectory to the Git root used by campaigns", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "codex-factory-subdir-"));
  const repository = path.join(parent, "repository");
  bootstrapRepository(repository);
  const nested = path.join(repository, "packages", "app");
  mkdirSync(nested, { recursive: true });
  const intake = createCoordinatorIntake({ repository: nested, prompt: "Add a small command to the nested package.", campaignId: "nested" });

  assert.equal(intake.repository, repository);
  assert.equal(existsSync(intake.sourcePath), true);
});

test("createCoordinatorIntake rejects bare repositories before writing coordinator state", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "codex-factory-bare-"));
  const repository = path.join(parent, "repository.git");
  assert.equal(spawnSync("git", ["init", "--bare", repository], { encoding: "utf8" }).status, 0);

  assert.throws(() => createCoordinatorIntake({ repository, prompt: "Build a small command line tool with tests.", campaignId: "bare" }), /non-bare/i);
  assert.equal(existsSync(path.join(repository, ".codex-factory")), false);
});

test("createCoordinatorIntake preserves tracked owner work by refusing a dirty worktree", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "codex-factory-dirty-"));
  const repository = path.join(parent, "repository");
  bootstrapRepository(repository);
  writeFileSync(path.join(repository, "owner.txt"), "first\n");
  assert.equal(spawnSync("git", ["add", "owner.txt"], { cwd: repository, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@local", "commit", "-m", "add owner file"], { cwd: repository, encoding: "utf8" }).status, 0);
  writeFileSync(path.join(repository, "owner.txt"), "owner change\n");

  assert.throws(() => createCoordinatorIntake({ repository, prompt: "Add a small command while preserving owner work.", campaignId: "dirty" }), /tracked owner changes/i);
  assert.equal(existsSync(path.join(repository, ".codex-factory")), false);
});

test("createCoordinatorIntake does not touch a redirected coordinator directory in the target repository", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "codex-factory-link-"));
  const repository = path.join(parent, "repository");
  const outside = path.join(parent, "outside");
  bootstrapRepository(repository);
  mkdirSync(outside);
  symlinkSync(outside, path.join(repository, ".codex-factory"), "junction");

  const intake = createCoordinatorIntake({ repository, prompt: "Build a safe prompt intake with tests.", campaignId: "no-link" });
  assert.equal(existsSync(intake.sourcePath), true);
  assert.equal(existsSync(path.join(outside, "coordinator")), false);
});

test("createCoordinatorIntake does not mutate a hard-linked Git exclude file in the target repository", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "codex-factory-exclude-link-"));
  const repository = path.join(parent, "repository");
  const outside = path.join(parent, "outside-exclude");
  assert.equal(spawnSync("git", ["init", repository], { encoding: "utf8" }).status, 0);
  writeFileSync(outside, "outside\n");
  const exclude = path.join(repository, ".git", "info", "exclude");
  unlinkSync(exclude);
  linkSync(outside, exclude);

  const intake = createCoordinatorIntake({ repository, prompt: "Build a small command line tool with tests.", campaignId: "linked-exclude" });
  assert.equal(existsSync(intake.sourcePath), true);
  assert.equal(readFileSync(outside, "utf8"), "outside\n");
});

test("bootstrapRepository never adopts an existing Git repository even if it carries a forged Factory marker", () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), "codex-factory-forged-"));
  assert.equal(spawnSync("git", ["init"], { cwd: repository, encoding: "utf8" }).status, 0);
  writeFileSync(path.join(repository, "owner.txt"), "owner history\n");
  assert.equal(spawnSync("git", ["add", "owner.txt"], { cwd: repository, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["-c", "user.name=Owner", "-c", "user.email=owner@local", "commit", "-m", "owner history"], { cwd: repository, encoding: "utf8" }).status, 0);
  writeFileSync(path.join(repository, ".git", "codex-factory-bootstrap.json"), `${JSON.stringify({
    version: 1,
    owner: "codex-factory",
    state: "initializing",
    repository,
    nonce: "a".repeat(48),
  })}\n`);

  assert.throws(() => bootstrapRepository(repository), /already a Git repository/i);
  assert.equal(spawnSync("git", ["log", "-1", "--pretty=%s"], { cwd: repository, encoding: "utf8" }).stdout.trim(), "owner history");
});

test("bootstrapRepository initializes only an empty target and gives the coordinator a usable Git base", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "codex-factory-bootstrap-"));
  const repository = path.join(parent, "new-product");
  const bootstrapped = bootstrapRepository(repository);

  assert.equal(bootstrapped, repository);
  assert.equal(existsSync(path.join(repository, ".git")), true);
  assert.equal(existsSync(path.join(repository, ".gitignore")), false);
  assert.throws(() => bootstrapRepository(repository), /already a Git repository/i);
});

test("bootstrapRepository refuses a nonempty non-Git directory instead of adopting owner files", () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), "codex-factory-owner-files-"));
  writeFileSync(path.join(repository, "important.txt"), "owner data\n");

  assert.throws(() => bootstrapRepository(repository), /must not already exist/i);
  assert.equal(readFileSync(path.join(repository, "important.txt"), "utf8"), "owner data\n");
  assert.equal(existsSync(path.join(repository, ".git")), false);
});

test("bootstrapRepository preserves an existing empty directory instead of replacing it", () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), "codex-factory-empty-owner-dir-"));

  assert.throws(() => bootstrapRepository(repository), /must not already exist/i);
  assert.equal(existsSync(repository), true);
  assert.equal(existsSync(path.join(repository, ".git")), false);
});

test("createCoordinatorIntake rejects prompt content that is missing or non-actionable", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-factory-empty-"));
  const repository = path.join(root, "repository");
  bootstrapRepository(repository);
  assert.throws(() => createCoordinatorIntake({
    repository,
    promptFile: path.join(root, "owner-spec.md"),
    prompt: "   ",
    campaignId: "empty",
    base: "HEAD",
  }), /prompt/i);
});
