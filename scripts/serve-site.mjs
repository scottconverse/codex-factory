#!/usr/bin/env node
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.CODEX_FACTORY_SITE_PORT ?? 4173);
const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);
const notFoundPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page not found — Codex Factory</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="site-header"><nav class="nav shell" aria-label="Primary navigation"><a class="brand" href="/"><img src="/mark.svg" alt="" width="34" height="34"><span>Codex Factory</span></a></nav></header>
  <main class="shell section"><p class="eyebrow">404 / Unknown route</p><h1>Page not found</h1><p class="lede">The requested page does not exist.</p><p><a class="button" href="/">Return to Codex Factory</a></p></main>
  <footer class="site-footer"><div class="shell footer-grid"><div class="brand footer-brand"><img src="/mark.svg" alt="" width="34" height="34"><span>Codex Factory</span></div><p>Open-source experimental supervision for bounded AI software workers.</p></div></footer>
</body>
</html>`;

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {
      allow: "GET, HEAD",
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("Method not allowed");
    return;
  }
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(root, relative);
  if (!target.startsWith(root) || !existsSync(target) || !statSync(target).isFile()) {
    response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : notFoundPage);
    return;
  }
  response.writeHead(200, { "content-type": types.get(path.extname(target)) ?? "application/octet-stream" });
  response.end(request.method === "HEAD" ? undefined : readFileSync(target));
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Codex Factory site: http://127.0.0.1:${port}\n`);
});
