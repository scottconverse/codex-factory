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
- one invocation per candidate route: qualified local first, then Luna and
  Terra when the reviewed ladder is qualified and paid admission succeeds;
- single-use worker task IDs and no retry of the same candidate route;
- lock-scoped aggregate budget admission and durable reservations;
- wall-clock timeout, interrupt handling, and owned process-tree cleanup;
- JSONL events, stderr, final-message, result, and usage receipts;
- a direct-Ollama structured patch path that validates model output, writes only
  allowlisted files in an isolated worktree, runs a declared check, and commits
  only on green;
- Codex plugin metadata and an operator skill.

## Coordinate from an owner prompt

Requirements: Node.js 24+, Git, and Codex CLI. Ollama is required for local
candidate discovery and qualification.

```powershell
git clone https://github.com/scottconverse/codex-factory.git
cd codex-factory
npm.cmd run check
```

Open this checkout as the workspace for a new top-level Codex task. Tell the
currently selected Codex model:

```text
Read skills/codex-factory/SKILL.md completely and use it to coordinate this request.
Target repository: C:\work\my-project
Request: Add a health-check endpoint with tests.
```

The selected model in that top-level task is the coordinator. It inspects the
repository, decides whether decomposition helps, creates the private
`campaign.json`, previews worker routes, integrates accepted results, and keeps
the owner-facing conversation. The owner does not write Factory JSON. Use a
clean target worktree: intake refuses tracked uncommitted owner changes rather
than stashing, resetting, or silently omitting them.

When no target repository exists, give the coordinator one explicit destination
that does not exist:

```text
Read skills/codex-factory/SKILL.md completely and use it to coordinate this request.
New project destination: C:\work\new-project
Request: Build a small command-line timer.
```

Factory refuses to replace any existing bootstrap destination.

The low-level intake command is for debugging or manual operation:

```powershell
node scripts/coordinator-intake.mjs --repository C:\work\my-project --prompt "Add a health-check endpoint with tests."
```

The intake produces a private source and a reserved internal plan path below
Factory's `.codex-factory/coordinator/` state, without writing coordinator
state into the target repository. The coordinator carries the source text in
its internal plan and pins the inspected `HEAD` commit. Preview and execution
refuse tracked owner edits or a different `HEAD`; create a fresh intake instead
of silently running a stale plan. Tasks can share a batch only when their paths do
not overlap in either direction. Each task first uses one qualified local model;
a fast local failure automatically advances through the reviewed local, Luna,
and Terra ladder, when those exact routes are currently qualified and admitted
by the paid ledger. `--execute` authorizes that displayed ladder; each candidate
is invoked at most once.
Execution creates an isolated integration worktree and never merges it into the
owner branch automatically.

See the [user manual](docs/USER-MANUAL.md) for the complete coordinator journey,
qualification, routes, receipts, recovery, and FAQ.

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
being removed from the fleet. The current host must qualify the exact candidate
ID, runtime and adapter versions, capabilities, model digest when available,
tier, reasoning effort, and versioned role-harness identifier before routing
begins. Those
host-specific records remain private; tracked examples are not runtime
allowlists.

The prompt-driven coordinator work on `main` after the `v0.1.3` tag is
**Unreleased**. Package and site version labels remain at the latest published
release until the owner selects the next version.

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
