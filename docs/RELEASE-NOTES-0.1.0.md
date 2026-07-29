# Codex Factory 0.1.0

Codex Factory 0.1.0 is the first experimental release of a local supervision
layer for bounded Codex and Ollama software workers.

## Why it exists

Codex already provides model execution, authentication, sandboxes, JSONL events,
and local-provider support. Codex Factory tests how much of a trustworthy
boss-and-worker development system can be built by supervising those native
surfaces instead of replacing them.

The initial release focuses on the evidence boundary:

- which provider and model was selected;
- which sandbox and repository were assigned;
- which task contract entered the worker;
- whether the worker process ended and was reaped;
- what terminal usage Codex reported;
- which final artifact the worker produced.

## What works

- dry-run previews with exact CLI routing;
- checked-in Sol, Terra, Luna, and Ollama policies;
- one locked worker and one attempt per task;
- durable pre-launch reservations;
- terminal usage reconciliation;
- wall-clock and interrupt process-tree cleanup;
- retained local request, event, diagnostic, result, and usage artifacts;
- explicit separation between process completion and task acceptance.

## What the bakeoff taught us

The current Codex CLI exposes usage after a turn. A Terra review reserved 35,000
tokens but reported 241,086 at completion. The runner correctly rejected the
terminal result as over budget and prevented another configured paid launch, but
it could not stop the turn at 35,000.

That makes reservations useful admission policy, not hard real-time spend
controls. Any future factory design must account for that platform boundary.

## What this release is not

Version 0.1.0 does not include parallel scheduling, campaigns, dependency
graphs, automatic merging, semantic acceptance, a PM control room, an MCP
server, or a model qualification registry.

Use it for controlled local experiments and evidence collection. Do not treat it
as an unattended autonomous development system.

## Start here

- [Website](https://scottconverse.github.io/codex-factory/)
- [User manual](USER-MANUAL.md)
- [Architecture](ARCHITECTURE.md)
- [Security policy](../SECURITY.md)
- [Changelog](../CHANGELOG.md)
