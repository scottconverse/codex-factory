# Codex Factory 0.1.1

Codex Factory 0.1.1 replaces fixed worker routes with a discovered,
qualification-gated candidate pool.

## What changed

- Every installed Ollama model is inventoried automatically.
- Configured Luna, Terra, and Sol models join the same candidate pool.
- Embedding-only inventory remains visible but is not invoked as a worker.
- Qualifications bind the exact provider, model, runtime, adapter, role, and
  harness fingerprint.
- Analysis, structured reasoning, structured writes, and workspace writes have
  separate evidence.
- A failure in one role does not globally exclude a model.
- Mutating admission requires both its write harness and the structured
  reasoning benchmark.
- Routing prefers a qualified free local candidate before a metered Codex
  candidate that satisfies the required tier.
- The constrained local patch runner selects from the currently qualified pool
  instead of naming one model.

## Historical operating boundary at the 0.1.1 release

The factory still runs one worker at a time and never retries automatically.
Local inference is bounded by wall time and capacity; its token counts are
telemetry. Codex subscription usage remains terminal-only, so reservations are
admission controls rather than an in-turn hard stop.

Paid Luna, Terra, and Sol qualification remains explicit and budget-gated.

## Start here

- [Website](https://scottconverse.github.io/codex-factory/)
- [User manual](USER-MANUAL.md)
- [Architecture](ARCHITECTURE.md)
- [Security policy](../SECURITY.md)
- [Changelog](../CHANGELOG.md)
