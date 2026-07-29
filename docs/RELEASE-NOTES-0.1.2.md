# Codex Factory 0.1.2

Codex Factory 0.1.2 is a documentation, website, and licensing release. It does
not change worker execution code.

## What changed

- The landing page now explains discovered, role-qualified candidate selection,
  free-local-first routing, bounded single-worker execution, and retained
  receipts.
- Measured local qualification results are presented with their host and runtime
  scope instead of as universal model claims.
- Current limitations are explicit: no parallel scheduler, campaign dependency
  graph, PM control room, automatic acceptance or merge, MCP server, or hard
  in-turn Codex token cutoff.
- The project is now licensed under the Apache License 2.0.

## Current operating boundary

The factory runs one worker at a time and never retries automatically. Local
inference uses wall-time and process controls; local token counts are telemetry.
Paid Codex candidates remain explicit and aggregate-budget-gated.

## Start here

- [Website](https://scottconverse.github.io/codex-factory/)
- [User manual](USER-MANUAL.md)
- [Architecture](ARCHITECTURE.md)
- [License](../LICENSE)
