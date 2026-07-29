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
- a primary-Codex coordinator flow that accepts an owner prompt/specification,
  discovers an existing repository or safely bootstraps an empty one, then
  creates its dependency plan internally;
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

## Coordinate from a prompt

Use the Codex Factory skill in the top-level Codex session and give it the
owner request in normal language. That session is the coordinator: it inspects
the repository, decides whether decomposition helps, writes its internal plan,
and keeps integration and acceptance in the primary context. The owner does
not write a campaign JSON file. The target must have no tracked uncommitted
changes; Factory preserves owner work rather than incorporating it into a
campaign base.

For the underlying coordinator intake, provide an existing repository:

```powershell
node scripts/coordinator-intake.mjs --repository C:\work\my-project --prompt "Add a health-check endpoint with tests."
```

Or bootstrap a genuinely new project at an exact new path:

```powershell
node scripts/coordinator-intake.mjs --bootstrap C:\work\new-project --prompt "Build a small command-line timer."
```

The intake produces a private source and a reserved internal plan path below
Factory's `.codex-factory/coordinator/` state, without writing coordinator
state into the target repository. The coordinator carries the source text in
its internal plan, then previews
and executes `run-campaign`. Tasks can share a batch only when their paths do
not overlap in either direction. Each task first uses one qualified local model;
a fast local failure falls back to `gpt-5.6-luna`, then `gpt-5.6-terra`, when
those exact routes are currently qualified and admitted by the paid ledger.
Execution creates an isolated integration worktree and never merges it into the
owner branch automatically.

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
