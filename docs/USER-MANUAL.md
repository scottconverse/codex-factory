# Codex Factory user manual

Version 0.1.0

## What Codex Factory is

Codex Factory is an experimental local supervisor for bounded AI software
workers. A coordinator prepares a task contract, selects an explicit Codex or
Ollama route, reviews a dry run, and then starts one supervised `codex exec`
process. The runner records the selected model, permissions, timing, process
result, final message, and terminal usage.

The supervisor is designed to make delegation inspectable. It does not replace
the coordinator, verify a task's acceptance criteria automatically, or turn a
language model into a trusted autonomous developer.

## Requirements

- Windows, macOS, or Linux with Node.js 24 or newer
- Git
- Codex CLI available as `codex` (`codex.exe` on Windows)
- A Git repository for the worker's target directory
- Ollama for the included local-model route

Live route availability depends on the models and providers configured in the
operator's Codex environment.

## Installation

Clone the repository and verify it:

```powershell
git clone https://github.com/scottconverse/codex-factory.git
cd codex-factory
npm.cmd run check
```

No npm dependencies are required for the runner.

The repository is also shaped as a Codex plugin. Version 0.1.0 does not install
it automatically into a personal marketplace; operate it from the checkout.

## The operating model

Every task requires:

- a unique task ID;
- one route from `factory.config.json`;
- a Git-backed working directory;
- a prompt file with acceptance criteria, allowed paths, required checks, and a
  `Do not delegate` instruction;
- a reviewed dry-run preview;
- explicit `--execute` authorization.

Workers are leaves. They do not spawn more workers, merge, publish, install, or
make product decisions.

## Included routes

| Role | Provider | Default model | Reasoning | Sandbox | Reservation |
|---|---|---|---|---|---:|
| `mechanical` | OpenAI | `gpt-5.6-luna` | low | read-only | 20,000 |
| `standard` | OpenAI | `gpt-5.6-terra` | medium | workspace-write | 40,000 |
| `review` | OpenAI | `gpt-5.6-terra` | high | read-only | 35,000 |
| `critical` | OpenAI | `gpt-5.6-sol` | high | workspace-write | 60,000 |
| `local-read` | Ollama | `qwen3.5:4b` | low | read-only | 60,000 |

These are editable local defaults, not compatibility guarantees. Validate model
availability before execution.

## Prepare a task

Create a prompt such as:

```text
You are a bounded leaf worker. Do not delegate or spawn workers.

Task: inspect the repository and report its test commands. Do not edit.

Acceptance criteria

- Every command names its source manifest.
- Every named path exists.

Allowed paths

- Read this repository only.
- Write no files.

Required checks

- Run git rev-parse --show-toplevel.
- Confirm every named path exists.

Do not delegate

Complete this task yourself and return one final report.
```

The section markers are required. The runner rejects incomplete task contracts
before launching a model.

## Preview a run

```powershell
node scripts/run-worker.mjs `
  --task-id inspect-repository `
  --role local-read `
  --cwd . `
  --prompt-file examples/inventory.prompt.md
```

The preview prints:

- provider and model;
- reasoning effort;
- sandbox;
- token reservation;
- aggregate spent and remaining;
- wall-clock timeout;
- exact CLI arguments;
- `execute: false`.

Review all of it. A dry run starts no model process.

## Execute once

Add `--execute` only after the preview matches the intended task:

```powershell
node scripts/run-worker.mjs `
  --task-id inspect-repository `
  --role local-read `
  --cwd . `
  --prompt-file examples/inventory.prompt.md `
  --execute
```

Task IDs are single-use after reservation. The runner does not retry
automatically.

## Understand results

Each run writes `.codex-factory/runs/<run-id>/`:

| File | Meaning |
|---|---|
| `request.json` | Exact route, command, scope, and admission snapshot |
| `events.jsonl` | Codex CLI machine-readable events |
| `stderr.log` | Worker and provider diagnostics |
| `last-message.txt` | Final worker artifact |
| `result.json` | Terminal supervisor result and usage |

Aggregate reservation and terminal records are appended to
`.codex-factory/usage.jsonl`. The directory is ignored by Git because artifacts
may contain repository data.

Result statuses:

- `process_completed`: the CLI exited zero, reported usage, stayed within its
  reservation, and produced a nonempty final artifact;
- `over_budget`: terminal usage exceeded the reservation;
- `timed_out`: the wall-clock limit fired;
- `failed`: spawn, interrupt, output, usage, or exit requirements failed.

`process_completed` is not a task-acceptance verdict. The coordinator must still
inspect the artifact and run the required checks.

## Budgets and the important limitation

The initial configuration permits:

- 250,000 aggregate paid tokens;
- 1,000,000 aggregate local tokens;
- one worker at a time;
- one attempt per task;
- 30 minutes per worker.

Reservations are written under the worker lock before launch and reconciled
when terminal usage arrives. If a worker crashes before reporting usage, its
reservation remains charged.

Codex currently reports token usage after the turn. Therefore the runner can
reject an unsafe launch and reject an over-budget result, but it cannot
interrupt a single model turn at an exact token count. The wall-clock timer and
owned process tree are the hard runtime controls in 0.1.0.

## Process recovery

On timeout or SIGINT/SIGTERM, the runner terminates the owned child process tree
and waits up to ten seconds for it to close. If closure cannot be confirmed, it
leaves `.codex-factory/worker.lock` in place to prevent another launch.

Before removing a retained lock:

1. Read the lock file and identify its task and supervisor PID.
2. Inspect operating-system processes for the exact recorded worker.
3. Confirm that the worker and its descendants are gone.
4. Preserve the affected run artifacts.
5. Remove only that exact lock file.

Never broadly terminate unrelated Codex Desktop, Ollama, terminal, or editor
processes.

## Configuration

Edit `factory.config.json` deliberately. Validation requires:

- positive integer aggregate and route budgets;
- exactly one attempt and one concurrent worker in 0.1.0;
- known providers, sandboxes, and reasoning efforts;
- `paid: true` for OpenAI and `paid: false` for Ollama.

Adding concurrency, retries, writable local routes, or a new provider changes
the safety model and requires new tests and design evidence.

## Troubleshooting

### Reservation exceeds remaining budget

The route cannot be admitted. Inspect `.codex-factory/usage.jsonl`; do not raise
the ceiling merely to clear the error.

### Another worker owns the lock

Treat this as a stop condition. Follow the process-recovery procedure before
touching the lock.

### Paid usage is missing

The paid lane closes because usage cannot be trusted. Preserve the receipt and
diagnose the provider/CLI event stream.

### Local worker has no final artifact

The process may have spent its output budget on reasoning. The run must fail;
do not infer success from exit code or token usage.

### Model metadata warning

Codex may use fallback metadata for an unknown local model. Treat the route as
unqualified until its output and tool behavior have been tested.

## Current maturity

Version 0.1.0 is an experimental supervisor and evidence-producing prototype.
It is useful for controlled local bakeoffs and bounded delegation experiments.
It is not yet a campaign engine, parallel scheduler, PM control room, automatic
merge system, or hard real-time spend controller.
