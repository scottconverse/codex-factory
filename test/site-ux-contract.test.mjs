import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(root, "site", "index.html"), "utf8");
const css = readFileSync(path.join(root, "site", "styles.css"), "utf8");

test("routing table is a named keyboard-scroll region with a narrow-screen hint", () => {
  assert.match(html, /class="route-scroll-hint"[^>]*>[^<]*(?:swipe|scroll)/i);
  assert.match(html, /class="route-table"[^>]*role="region"[^>]*aria-label="[^"]+"[^>]*tabindex="0"/i);
  assert.match(html, /class="route-table"[\s\S]*?<table>[\s\S]*?<thead>[\s\S]*?<th scope="col"/);
  assert.match(css, /@media \(max-width: 840px\)[\s\S]*?\.route-scroll-hint\s*\{[^}]*display:\s*block/i);
});

test("start section gives a complete copyable coordinator prompt and a manual fallback", () => {
  const coordinate = html.match(/<section[^>]*id="coordinate"[\s\S]*?<\/section>/i)?.[0] ?? "";
  assert.match(coordinate, /<pre[^>]*class="coordinator-prompt"/i);
  assert.match(coordinate, /Read and follow skills\/codex-factory\/SKILL\.md completely/i);
  assert.match(coordinate, /Target repository:/i);
  assert.match(coordinate, /Owner request:/i);
  assert.match(coordinate, /docs\/USER-MANUAL\.md#campaign-coordination/i);
  assert.match(coordinate, /manual fallback/i);
});

test("mobile navigation starts at 840px and visible links have 44px hit targets", () => {
  assert.match(css, /@media \(max-width: 840px\)/);
  assert.match(css, /@media \(max-width: 840px\)[\s\S]*?\.menu-button\s*\{[^}]*display:\s*inline-flex/i);
  for (const selector of [".site-header .brand", ".nav-links > a", ".hero-actions a", ".text-link", ".final-actions a", ".footer-links a"]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(css, new RegExp(`${escaped}[^}]*min-height:\\s*44px`, "i"), `${selector} needs a 44px mobile hit height`);
  }
});
