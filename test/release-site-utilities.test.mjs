import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

function run(script, args = [], options = {}) {
  return spawnSync(node, [script, ...args], {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createReleaseFixture() {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "codex-factory-release-"));
  mkdirSync(path.join(fixture, "scripts"), { recursive: true });
  mkdirSync(path.join(fixture, ".codex-plugin"), { recursive: true });
  mkdirSync(path.join(fixture, "docs"), { recursive: true });
  mkdirSync(path.join(fixture, "site"), { recursive: true });
  mkdirSync(path.join(fixture, ".github", "workflows"), { recursive: true });
  copyFileSync(path.join(root, "scripts", "check-release.mjs"), path.join(fixture, "scripts", "check-release.mjs"));
  writeFileSync(path.join(fixture, "VERSION"), "0.1.3\n");
  writeFileSync(path.join(fixture, "package.json"), '{"type":"module","version":"0.1.3"}\n');
  writeFileSync(path.join(fixture, ".codex-plugin", "plugin.json"), '{"version":"0.1.3"}\n');
  const publicCopy = "0.1.3 cannot interrupt a single process_completed\n";
  for (const relative of ["README.md", "CHANGELOG.md", "docs/USER-MANUAL.md", "site/index.html"]) {
    writeFileSync(path.join(fixture, relative), publicCopy);
  }
  for (const relative of [
    "CONTRIBUTING.md",
    "LICENSE",
    "SECURITY.md",
    "docs/ARCHITECTURE.md",
    "docs/RELEASE-NOTES-0.1.3.md",
    ".github/workflows/pages.yml",
  ]) {
    writeFileSync(path.join(fixture, relative), "fixture\n");
  }
  git(fixture, "init");
  git(fixture, "config", "core.autocrlf", "false");
  git(fixture, "config", "user.email", "fixture@example.invalid");
  git(fixture, "config", "user.name", "Fixture");
  git(fixture, "add", ".");
  git(fixture, "commit", "-m", "release");
  git(fixture, "tag", "v0.1.3");
  return fixture;
}

test("release mode binds a clean candidate to the exact v<VERSION> tag", () => {
  const fixture = createReleaseFixture();
  const script = path.join(fixture, "scripts", "check-release.mjs");
  assert.equal(run(script, ["--release"], { cwd: fixture }).status, 0);

  writeFileSync(path.join(fixture, "README.md"), "dirty\n", { flag: "a" });
  const dirty = run(script, ["--release"], { cwd: fixture });
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /dirty/i);

  git(fixture, "restore", "README.md");
  writeFileSync(path.join(fixture, "after-release.txt"), "new commit\n");
  git(fixture, "add", ".");
  git(fixture, "commit", "-m", "after release");
  const ahead = run(script, ["--release"], { cwd: fixture });
  assert.equal(ahead.status, 1);
  assert.match(ahead.stderr, /exactly v0\.1\.3/i);
});

test("development release validation reports that HEAD is ahead of the version tag", () => {
  const fixture = createReleaseFixture();
  writeFileSync(path.join(fixture, "after-release.txt"), "new commit\n");
  git(fixture, "add", ".");
  git(fixture, "commit", "-m", "after release");
  const result = run(path.join(fixture, "scripts", "check-release.mjs"), ["--development"], { cwd: fixture });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /HEAD is 1 commit ahead of v0\.1\.3/i);
});

test("release validation prints a concise expected failure without a stack", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "codex-factory-release-error-"));
  mkdirSync(path.join(fixture, "scripts"));
  copyFileSync(path.join(root, "scripts", "check-release.mjs"), path.join(fixture, "scripts", "check-release.mjs"));
  const result = run(path.join(fixture, "scripts", "check-release.mjs"), ["--release"], { cwd: fixture });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Release check failed: /);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test("site validation updates stale versioned cards and intentionally permits an evergreen card", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "codex-factory-site-"));
  mkdirSync(path.join(fixture, "scripts"));
  mkdirSync(path.join(fixture, "site"));
  copyFileSync(path.join(root, "scripts", "build-site.mjs"), path.join(fixture, "scripts", "build-site.mjs"));
  copyFileSync(path.join(root, "scripts", "check-site.mjs"), path.join(fixture, "scripts", "check-site.mjs"));
  writeFileSync(path.join(fixture, "VERSION"), "0.1.3\n");
  writeFileSync(
    path.join(fixture, "site", "index.html"),
    '<main id="main"><i id="top"></i><i id="controls"></i><i id="workflow"></i><i id="quick-start"></i><i id="status"></i>0.1.3<img src="social-card.svg"></main>',
  );
  for (const asset of ["styles.css", "app.js", "mark.svg"]) writeFileSync(path.join(fixture, "site", asset), "asset\n");
  writeFileSync(path.join(fixture, "site", "social-card.svg"), '<svg><text>0.1.1</text></svg>\n');

  assert.equal(run(path.join(fixture, "scripts", "build-site.mjs"), [], { cwd: fixture }).status, 0);
  assert.match(readFileSync(path.join(fixture, "dist", "social-card.svg"), "utf8"), /0\.1\.3/);
  assert.equal(run(path.join(fixture, "scripts", "check-site.mjs"), [], { cwd: fixture }).status, 0);

  writeFileSync(path.join(fixture, "dist", "social-card.svg"), '<svg><text>0.1.1</text></svg>\n');
  const stale = run(path.join(fixture, "scripts", "check-site.mjs"), [], { cwd: fixture });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /social-card\.svg.*0\.1\.1.*0\.1\.3/i);
  assert.doesNotMatch(stale.stderr, /\n\s+at /);

  writeFileSync(path.join(fixture, "dist", "social-card.svg"), "<svg><text>Codex Factory</text></svg>\n");
  const evergreen = run(path.join(fixture, "scripts", "check-site.mjs"), [], { cwd: fixture });
  assert.equal(evergreen.status, 0, "an evergreen social card intentionally carries no release version");
});

function request(port, method) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, path: "/", method }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

test("preview server permits only GET and HEAD", async (context) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "codex-factory-site-server-"));
  mkdirSync(path.join(fixture, "scripts"));
  mkdirSync(path.join(fixture, "dist"));
  copyFileSync(path.join(root, "scripts", "serve-site.mjs"), path.join(fixture, "scripts", "serve-site.mjs"));
  writeFileSync(path.join(fixture, "dist", "index.html"), "preview\n");
  const port = await reserveFreePort();
  const child = spawn(node, [path.join(fixture, "scripts", "serve-site.mjs")], {
    cwd: fixture,
    env: { ...process.env, CODEX_FACTORY_SITE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => child.kill());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("preview server did not start")), 5000);
    child.stdout.once("data", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("error", reject);
  });

  const get = await request(port, "GET");
  assert.equal(get.status, 200);
  assert.equal(get.body, "preview\n");
  const head = await request(port, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  const post = await request(port, "POST");
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET, HEAD");
});
