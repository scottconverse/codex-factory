# Codex Factory agent contract

- The coordinator owns requirements, routing, integration, and final claims.
- Workers are bounded leaves. They must never spawn or delegate to other workers.
- Use the selected candidate returned from current exact-role qualification;
  never substitute an unqualified model.
- A worker needs a task ID, acceptance criteria, writable scope, pricing-tier
  controls, a wall-clock limit, and deterministic exit before execution.
- Dry-run is the default. Model execution requires an explicit `--execute`.
- Do not retry the same candidate route. Diagnose or return its failed receipt.
  A reviewed campaign may advance once through its previewed local, Luna, and
  Terra ladder; containment or infrastructure failures abort that ladder.
- A task ID is single-use after its durable reservation is written.
- Never exceed the aggregate paid-token ceiling. Unknown usage closes the paid lane.
- Configure one to four worker slots; the checked-in policy uses three.
  Only dependency-ready `parallelSafe` campaign tasks with non-overlapping read/write
  paths may share a batch. Paid admission remains serialized under the ledger lock.
- Every execution must retain its prompt, JSONL events, stderr, final message, usage,
  exit status, model, provider, and timestamps under `.codex-factory/runs/`.
- Local models receive read-only work until a recorded qualification proves the tools and
  output contract required by a writable task.
- Discover every installed Ollama model and every configured Codex candidate.
  Qualification failures are exact-model, exact-runtime, exact-harness, and
  role scoped; never turn one failed role into a global model exclusion.
- `process_completed` proves only a reaped CLI process, terminal usage, and a nonempty
  final artifact. It does not prove the task acceptance criteria.
- Do not add a PM control room, MCP server, marketplace publication, or additional
  providers without an explicit product decision and matching safety evidence.
