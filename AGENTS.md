# Codex Factory agent contract

- The coordinator owns requirements, routing, integration, and final claims.
- Workers are bounded leaves. They must never spawn or delegate to other workers.
- Use the route in `factory.config.json`; do not silently substitute a model.
- A worker needs a task ID, acceptance criteria, writable scope, pricing-tier
  controls, a wall-clock limit, and deterministic exit before execution.
- Dry-run is the default. Model execution requires an explicit `--execute`.
- Never retry automatically. Diagnose or return the failed receipt.
- A task ID is single-use after its durable reservation is written.
- Never exceed the aggregate paid-token ceiling. Unknown usage closes the paid lane.
- One worker may run at a time until concurrency accounting is deliberately implemented.
- Every execution must retain its prompt, JSONL events, stderr, final message, usage,
  exit status, model, provider, and timestamps under `.codex-factory/runs/`.
- Local models receive read-only work until a recorded qualification proves the tools and
  output contract required by a writable task.
- `gemma4:12b` is qualified only for `run-local-patch.mjs` structured-file writes;
  it is not qualified for autonomous shell or filesystem tools.
- `process_completed` proves only a reaped CLI process, terminal usage, and a nonempty
  final artifact. It does not prove the task acceptance criteria.
- Do not add MCP, marketplace installation, UI, or additional providers until the
  supervised CLI runner passes its bakeoff acceptance criteria.
