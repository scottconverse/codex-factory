import http from "node:http";

const MODEL = "qwen3.5:14b";

function send(response, payload, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    if (request.url === "/api/version") return send(response, { version: "0.11.0-test" });
    if (request.url === "/api/tags") {
      return send(response, { models: [{ name: MODEL, digest: "sha256:boundary-fixture" }] });
    }
    if (request.url === "/api/show") return send(response, { capabilities: ["completion"] });
    if (request.url === "/api/generate") {
      if (process.env.CODEX_FACTORY_FAKE_OLLAMA_FAILURE === "generate") {
        return send(response, { error: "fixture generation failure" }, 503);
      }
      let artifact;
      if (body.prompt?.includes("two legs")) {
        artifact = JSON.stringify({ valid: false, reason: "60 mm exceeds 40 mm", holeCount: 4 });
      } else if (body.prompt?.includes("src/value.mjs")) {
        artifact = JSON.stringify({
          files: [{ path: "src/value.mjs", content: "export const value = 42;\n" }],
          summary: "Created the exact qualification fixture.",
        });
      } else {
        artifact = JSON.stringify({
          files: [{ path: "src/result.txt", content: "built by local executable\n" }],
          summary: "Created the bounded local result.",
        });
      }
      return send(response, {
        response: artifact,
        prompt_eval_count: 11,
        eval_count: 7,
        total_duration: 1,
      });
    }
    response.writeHead(404);
    response.end();
  });
});

server.listen(0, "127.0.0.1", () => {
  if (process.send) process.send({ port: server.address().port });
});

process.on("message", (message) => {
  if (message === "close") server.close(() => process.exit(0));
});
