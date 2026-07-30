import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROUTELLM_REVISION = "0b64fdafe049e596a3f5657c219329f24af24198";
const FACTORY_FORK_REVISION = "60bc73c7e31b7c931271ae44a8543a8b082ba163";
const ROUTELLM_LICENSE_SHA256 = "5ad8c213095c573921d7388edf93f6a9f54490b8ebf3b165ae8ef1947cf70846";
const ROUTER_BOOTSTRAP_PIP = "26.1.2";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("vendored RouteLLM source retains its pinned Apache-2.0 attribution", () => {
  assert.equal(read("third_party/routellm/REVISION").trim(), ROUTELLM_REVISION);

  const license = readFileSync(new URL("../third_party/routellm/LICENSE", import.meta.url));
  assert.equal(createHash("sha256").update(license).digest("hex"), ROUTELLM_LICENSE_SHA256);
  assert.match(license.toString("utf8"), /^\s*Apache License\s+Version 2\.0, January 2004/);

  const notice = read("third_party/routellm/NOTICE.md");
  for (const requiredAttribution of [
    "https://github.com/lm-sys/RouteLLM",
    "https://github.com/scottconverse/RouteLLM",
    ROUTELLM_REVISION,
    FACTORY_FORK_REVISION,
    "LMSYS",
    "Isaac Ong",
    "Amjad Almahairi",
    "Vincent Wu",
    "Wei-Lin Chiang",
    "Tianhao Wu",
    "Joseph E. Gonzalez",
    "M. Waleed Kadous",
    "Ion Stoica",
    "Anyscale",
    "https://arxiv.org/abs/2406.18665",
    "must not be represented as",
  ]) {
    assert.match(notice, new RegExp(requiredAttribution.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const modifiedUpstreamFile of [
    "third_party/routellm/routellm/routers/similarity_weighted/utils.py",
    "third_party/routellm/routellm/routers/matrix_factorization/model.py",
    "third_party/routellm/routellm/routers/routers.py",
  ]) {
    assert.match(
      read(modifiedUpstreamFile),
      /Modified by Codex Factory:/,
      `${modifiedUpstreamFile} must carry the Apache-2.0 section 4(b) modification notice`,
    );
  }
});

test("router bootstrap upgrades pip from a hash-locked reviewed artifact", () => {
  const bootstrapLock = read("requirements-router-bootstrap.lock");
  assert.match(bootstrapLock, new RegExp(`pip==${ROUTER_BOOTSTRAP_PIP.replaceAll(".", "\\.")}`));
  assert.match(bootstrapLock, /--hash=sha256:[a-f0-9]{64}/);
  const setup = read("scripts/setup-router.ps1");
  assert.match(setup, /requirements-router-bootstrap\.lock/);
  assert.match(setup, /"--require-hashes", "--only-binary=:all:", "--upgrade"/);
  assert.match(setup, /bootstrapLockSha256/);
});
