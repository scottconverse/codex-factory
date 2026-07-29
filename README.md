# Codex Factory

**Give AI workers a shift, not a blank check.**

Codex Factory is an experimental local supervisor for bounded Codex and Ollama
software workers. It routes one task to an explicit model and sandbox, records a
durable token reservation, owns the child process tree, and retains the request,
events, result, and terminal usage as evidence.

[Website](https://scottconverse.github.io/codex-factory/) ·
[User manual](docs/USER-MANUAL.md) ·
[Architecture](docs/ARCHITECTURE.md) ·
[Worker model ladder](docs/MODEL-LADDER.md) ·
[Changelog](CHANGELOG.md)

## What 0.1.0 includes

- explicit Sol, Terra, Luna, and Ollama routes;
- dry-run by default and one worker at a time;
- single-use task IDs and no automatic retries;
- lock-scoped aggregate budget admission and durable reservations;
- wall-clock timeout, interrupt handling, and owned process-tree cleanup;
- JSONL events, stderr, final-message, result, and usage receipts;
- Codex plugin metadata and an operator skill.

## Quick start

Requirements: Node.js 24+, Git, and Codex CLI. Ollama is required only for the
included local route.

```powershell
git clone https://github.com/scottconverse/codex-factory.git
cd codex-factory
npm.cmd run check

node scripts/run-worker.mjs `
  --task-id inspect-repo `
  --role local-read `
  --cwd . `
  --prompt-file examples/inventory.prompt.md
```

The command is a dry run. It prints the model, provider, reasoning effort,
sandbox, token reservation, timeout, and exact CLI arguments with
`"execute": false`. Add `--execute` only after the preview matches the intended
task.

See the [user manual](docs/USER-MANUAL.md) for task contracts, route details,
execution, receipts, recovery, and troubleshooting.

## Important boundary

Codex reports token usage after a model turn. Version 0.1.0 can reject an unsafe
launch and mark a terminal result over budget, but it cannot interrupt a single
turn at an exact token count. Wall-clock timeout and process ownership are the
hard runtime controls.

`process_completed` means only that the CLI exited zero, reported usage, stayed
within its reservation, and produced a nonempty final artifact. It is not proof
that the task passed acceptance.

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

Version 0.1.0 is an evidence-producing prototype for controlled delegation
experiments. It is not a campaign engine, parallel scheduler, PM control room,
automatic merge system, semantic verifier, or hard real-time spend controller.
Read-only delegation has narrow qualification evidence; writable Codex and local
workers are not yet qualified on the tested host.

## Project documents

- [User manual](docs/USER-MANUAL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Worker model ladder](docs/MODEL-LADDER.md)
- [0.1.0 release notes](docs/RELEASE-NOTES-0.1.0.md)
- [Capability matrix](docs/CAPABILITY-MATRIX.md)
- [Experiment plan](docs/EXPERIMENT-PLAN.md)
- [Bakeoff ledger](docs/BAKEOFF-LEDGER.md)
- [Decisions](docs/DECISIONS.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [License](LICENSE)

Copyright © 2026 Scott Converse. All rights reserved.
