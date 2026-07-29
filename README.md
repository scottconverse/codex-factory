# Codex Factory

**Give AI workers a shift, not a blank check.**

Codex Factory is an experimental local supervisor for bounded Codex and Ollama
software workers. It discovers candidates, admits only models with a current
exact-role qualification, prefers qualified free local capacity, owns the child
process tree, and retains selection and execution evidence.

[Website](https://scottconverse.github.io/codex-factory/) ·
[User manual](docs/USER-MANUAL.md) ·
[Architecture](docs/ARCHITECTURE.md) ·
[Worker model ladder](docs/MODEL-LADDER.md) ·
[Changelog](CHANGELOG.md)

## What the coordinator includes

- discovery of every installed Ollama model plus configured Sol, Terra, and Luna candidates;
- fingerprinted analysis, structured-reasoning benchmark, structured-write,
  and workspace-write qualification;
- automatic selection from the currently qualified pool;
- a campaign coordinator that accepts a prompt/specification plus a dependency plan;
- dry-run by default, with up to four explicitly declared non-overlapping workers;
- one qualified local attempt first, then explicit Luna and Terra fallbacks;
- single-use task IDs and no automatic retries;
- lock-scoped aggregate budget admission and durable reservations;
- wall-clock timeout, interrupt handling, and owned process-tree cleanup;
- JSONL events, stderr, final-message, result, and usage receipts;
- a direct-Ollama structured patch path that validates model output, writes only
  allowlisted files in an isolated worktree, runs a declared check, and commits
  only on green;
- Codex plugin metadata and an operator skill.

## Quick start

Requirements: Node.js 24+, Git, and Codex CLI. Ollama is required for local
candidate discovery and qualification.

```powershell
git clone https://github.com/scottconverse/codex-factory.git
cd codex-factory
npm.cmd run check
npm.cmd run fleet:qualify

node scripts/run-worker.mjs `
  --task-id inspect-repo `
  --role local-read `
  --cwd . `
  --prompt-file examples/inventory.prompt.md
```

`fleet:qualify` previews every applicable candidate/harness pair without model
inference. Add `--execute` to qualify free local candidates; paid Codex
candidates additionally require `--include-paid`.

The worker command is also a dry run. It prints the selected currently qualified
model, provider, reasoning effort,
sandbox, applicable token policy, timeout, and exact CLI arguments with
`"execute": false`. Add `--execute` only after the preview matches the intended
task.

See the [user manual](docs/USER-MANUAL.md) for task contracts, route details,
execution, receipts, recovery, and troubleshooting.

## Coordinate a campaign

Put the owner prompt or specification beside a small campaign plan. The included
example is safe by default: it only previews selection and scheduling.

```powershell
node scripts/run-campaign.mjs --plan-file examples/campaign-plan.json
```

The plan has named tasks, exact read/write paths, dependencies, checks, and a
`parallelSafe` declaration. Tasks may share a batch only when their paths do
not overlap in either direction. The coordinator first dispatches one current
qualified local model for each task. A fast local failure falls back to
`gpt-5.6-luna`, then `gpt-5.6-terra`, when those exact routes are currently
qualified and admitted by the paid ledger. Add `--execute` only after reviewing
the preview; execution creates an isolated integration worktree and never
merges it into your branch automatically.

## Important boundary

Codex reports token usage after a model turn. Version 0.1.3 can reject an unsafe
launch and mark a terminal result over budget, but it cannot interrupt a single
turn at an exact token count. Wall-clock timeout and process ownership are the
hard runtime controls.

`process_completed` means only that the CLI exited zero, reported usage, stayed
within its reservation, and produced a nonempty final artifact. It is not proof
that the task passed acceptance.

Local Ollama workers do not have token-spend budgets. Their hard controls are
wall time, concurrency, attempts, context/output safety, and process cleanup.
Token counts are retained only as performance telemetry.

## Website development

The dependency-free static website lives in `site/`.

```powershell
npm.cmd run site:build
npm.cmd run site:check
npm.cmd run site:serve
```

The preview server uses `http://127.0.0.1:4173` by default. Set
`CODEX_FACTORY_SITE_PORT` to use another port.

## Status

Codex Factory is an evidence-producing coordinator for controlled delegation.
It is not a PM control room, automatic merge system, semantic verifier, or hard
real-time spend controller.
Candidate availability is discovered rather than hardcoded. Qualification is
role scoped: a model may qualify for analysis and fail structured writes without
being removed from the fleet. The current host must qualify its exact runtime
fingerprints before routing begins.

## Project documents

- [User manual](docs/USER-MANUAL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Worker model ladder](docs/MODEL-LADDER.md)
- [0.1.3 release notes](docs/RELEASE-NOTES-0.1.3.md)
- [Capability matrix](docs/CAPABILITY-MATRIX.md)
- [Experiment plan](docs/EXPERIMENT-PLAN.md)
- [Bakeoff ledger](docs/BAKEOFF-LEDGER.md)
- [Decisions](docs/DECISIONS.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [License](LICENSE)

Copyright © 2026 Scott Converse. Licensed under the
[Apache License 2.0](LICENSE).
