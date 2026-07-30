import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public qualification copy does not present an unverifiable host snapshot", () => {
  const site = read("site/index.html");

  assert.doesNotMatch(site, /17<\/strong><span>installed models inventoried/);
  assert.doesNotMatch(site, /48<\/strong><span>role checks executed/);
  assert.doesNotMatch(site, /write-ready on this host/);
  assert.match(site, /illustrative/i);
});

test("operator documentation names every field in the admission fingerprint", () => {
  const manual = read("docs/USER-MANUAL.md");

  for (const field of [
    "candidate ID",
    "runtime version",
    "adapter version",
    "capabilities",
    "model digest",
    "tier",
    "reasoning effort",
    "versioned role-harness identifier",
  ]) {
    assert.match(manual, new RegExp(field, "i"), `missing fingerprint field: ${field}`);
  }
});

test("public retry copy distinguishes one invocation per route from automatic fallback", () => {
  const publicText = [read("README.md"), read("docs/USER-MANUAL.md"), read("site/index.html")].join("\n");

  assert.match(publicText, /one invocation per candidate route/i);
  assert.match(publicText, /automatically advances through the reviewed local,\s+Luna,\s+and Terra ladder/i);
  assert.doesNotMatch(publicText, /single-use task IDs and no automatic retries/i);
});

test("repository agent contract permits the documented preview-authorized fallback ladder", () => {
  const agents = read("AGENTS.md");

  assert.match(agents, /do not retry the same candidate route/i);
  assert.match(agents, /reviewed campaign may advance once through.*local.*Luna.*Terra/is);
  assert.doesNotMatch(agents, /Never retry automatically/);
});
