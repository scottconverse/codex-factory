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
    "role harness",
  ]) {
    assert.match(manual, new RegExp(field, "i"), `missing fingerprint field: ${field}`);
  }
});
