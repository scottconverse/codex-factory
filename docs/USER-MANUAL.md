# Codex Factory user manual

Version 0.1.2

## What Codex Factory is

Codex Factory is an experimental local supervisor for bounded AI software
workers. A coordinator prepares a task contract and role policy. The factory
discovers installed Ollama models and configured Codex candidates, admits only
current exact-role qualifications, and selects a worker before the reviewed dry
run. The runner records the selection factors, permissions, timing, process
result, final message, and terminal usage.

For constrained local writes, a separate direct-Ollama runner asks the model
for complete text for allowlisted files. The supervisor—not the model—creates
the worktree, writes files, derives the Git diff, runs the declared check, and
commits only on green.

The supervisor is designed to make delegation inspectable. It does not replace
the coordinator, verify a task's acceptance criteria automatically, or turn a
language model into a trusted autonomous developer.

## Requirements

- Windows, macOS, or Linux with Node.js 24 or newer
- Git
- Codex CLI available as `codex` (`codex.exe` on Windows)
- A Git repository for the worker's target directory
- Ollama for local-model discovery and qualification

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

The repository is also shaped as a Codex plugin. Version 0.1.2 does not install
it automatically into a personal marketplace; operate it from the checkout.

## The operating model

Every task requires:

- a unique task ID;
- one role policy from `factory.config.json`;
- a Git-backed working directory;
- a prompt file with acceptance criteria, allowed paths, required checks, and a
  `Do not delegate` instruction;
- a reviewed dry-run preview;
- explicit `--execute` authorization.

Workers are leaves. They do not spawn more workers, merge, publish, install, or
make product decisions.

## Candidate qualification and role policies

Preview the complete current fleet without invoking a model:

```powershell
npm.cmd run fleet:qualify
```

Execute every worker-capable local candidate against each applicable harness:

```powershell
npm.cmd run fleet:qualify -- --execute
```

Paid Codex qualification is excluded unless explicitly requested:

```powershell
npm.cmd run fleet:qualify -- --include-paid --execute
```

Ollama discovery inventories every installed model. Embedding-only models remain
visible but do not enter the subagent harness. Each result is bound to the exact
provider, model, runtime version, adapter version, role, and harness. A failed
structured-write qualification does not erase a passing analysis qualification.
Mutating admission also requires the candidate to pass a derived structured-
reasoning benchmark; a protocol-only write response is insufficient.

| Role policy | Required qualification | Minimum tier | Sandbox |
|---|---|---|---|
| `mechanical` | analysis | economy | read-only |
| `standard` | workspace write | standard | workspace-write |
| `review` | analysis | standard | read-only |
| `critical` | workspace write | premium | workspace-write |
| `local-read` | analysis | economy | read-only |

Qualified free local candidates are preferred. Metered Codex candidates are
considered only when no qualified local candidate satisfies the exact role and
tier.

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

## Run a constrained local patch

Create a task JSON with a Git root, exact context and write paths, a
command/argument array, and operational safety limits:

```json
{
  "version": 1,
  "taskId": "implement-slugify",
  "repository": "C:\\absolute\\path\\to\\repo",
  "base": "HEAD",
  "requiredTier": "standard",
  "timeoutMinutes": 3,
  "maxOutputTokens": 2048,
  "maxContextBytes": 65536,
  "instructions": "Implement and export slugify from the supplied test.",
  "readPaths": ["package.json", "test/slugify.test.mjs"],
  "writePaths": ["src/slugify.mjs"],
  "check": {
    "command": "node.exe",
    "args": ["--test", "test/slugify.test.mjs"]
  },
  "commitMessage": "feat: implement slugify"
}
```

Preview, then execute explicitly:

```powershell
npm.cmd run local:patch -- --task-file C:\path\to\task.json
npm.cmd run local:patch -- --task-file C:\path\to\task.json --execute
```

The factory selects a current structured-write-qualified local model. An
optional `model` field pins one qualified candidate; it never bypasses the
harness. The model receives only declared file contents and has no tools. Generated
paths must match `writePaths`. Traversal, unsafe Windows path characters,
duplicate paths, binary content, linked write paths, and unstaged path drift
are rejected. Raw evidence and the generated worktree remain under
`.codex-factory/local-patch/`.

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
- one worker at a time;
- one attempt per task;
- 30 minutes per worker.

Reservations are written under the worker lock before launch and reconciled
when terminal usage arrives. If a worker crashes before reporting usage, its
reservation remains charged.

Codex currently reports token usage after the turn. Therefore the runner can
reject an unsafe launch and reject an over-budget result, but it cannot
interrupt a single model turn at an exact token count. The wall-clock timer and
owned process tree are the hard runtime controls in 0.1.2.

Local Ollama inference has no token-spend ceiling. It is bounded by wall time,
concurrency, attempts, and context/output safety. Prompt and output token counts
are recorded only as performance telemetry. Codex subscription usage allowances
and any future paid API cost budget are separate accounting classes.

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

- a positive aggregate allowance for metered OpenAI/Codex candidates;
- a positive wall-clock limit for each qualification;
- exactly one attempt and one concurrent worker in 0.1.2;
- known role qualifications, tiers, sandboxes, and reasoning efforts;
- a token reservation for every configured metered Codex candidate;
- runtime discovery, rather than a fixed Ollama allowlist.

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

### No currently qualified candidate

Run the qualification preview. If the exact runtime fingerprint has no passing
record for the requested role, execute the applicable harness. Do not manually
mark a model qualified or reuse evidence from another role.

## Current maturity

Version 0.1.2 is an experimental supervisor and evidence-producing prototype.
It is useful for controlled local bakeoffs and bounded delegation experiments.
The factory now discovers the real local inventory and tests every
worker-capable candidate instead of relying on a hardcoded model ladder. It is
not yet a campaign engine, parallel scheduler, PM control room, automatic merge
system, or hard real-time spend controller.
