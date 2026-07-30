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
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": types.get(path.extname(target)) ?? "application/octet-stream" });
  response.end(request.method === "HEAD" ? undefined : readFileSync(target));
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Codex Factory site: http://127.0.0.1:${port}\n`);
});
