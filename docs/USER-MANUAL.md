# Codex Factory user manual

Version 0.1.4

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
- a Git worktree with no tracked uncommitted owner changes
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
npm.cmd run verify
```

No npm dependencies are required for the runner.

The repository is also shaped as a Codex plugin, but the checkout does not
install itself. The supported checkout path is:

1. Open the cloned Codex Factory checkout as the workspace for a new top-level
   Codex task.
2. Tell the currently selected model:

   ```text
   Read skills/codex-factory/SKILL.md completely and use it to coordinate this request.
   Target repository: C:\work\my-project
   Request: Add a health-check endpoint with tests.
   ```

3. Continue in that same task. The selected model is the coordinator; it owns
   repository inspection, private planning, routing, integration, acceptance,
   and communication.

This is checkout operation, not marketplace installation. Do not invoke the
skill by name unless you have separately installed a plugin version that
provides it.

## Campaign coordination

The selected model in the top-level Codex task using the Factory skill is the
owner-facing coordinator. It may be whatever Codex model the owner selected for
that task; Luna and Terra remain campaign fallback workers, not the coordinator,
unless the owner deliberately selected one as the top-level model. The owner
supplies a prompt, specification, or plan in normal
language. The coordinator inspects the target repository, decides whether to
decompose, and writes the JSON campaign plan privately; the owner never needs
to create that JSON.

First create the internal intake for an existing repository:

```powershell
node scripts/coordinator-intake.mjs --repository C:\work\my-project --prompt "Add a health-check endpoint with tests."
```

When there is no repository, the coordinator may bootstrap one only at an
explicit new target path that does not already exist:

```powershell
node scripts/coordinator-intake.mjs --bootstrap C:\work\new-project --prompt "Build a small command-line timer."
```

Bootstrap refuses every pre-existing target and records a clearly authored initial Git
commit so that isolated worker worktrees have a base. The intake copies the
owner source and reserves the coordinator's internal plan path under
Factory's `.codex-factory/coordinator/` state; it does not execute a worker or
write coordinator state into the target repository. The coordinator copies the
private source text into its internal plan rather than passing the owner a JSON
format.

Intake rejects tracked uncommitted changes. It does not stash, reset, or
silently include owner work in the campaign's `HEAD` base; preserve that work
and use a clean worktree for the campaign. Intake resolves the selected base to
the exact current commit. Campaign preview and execution refuse if tracked
files change or `HEAD` advances afterward; create a fresh intake so the private
plan is based on the repository state that will actually run.

The coordinator then writes the plan and runs `scripts/run-campaign.mjs` in
dry-run mode before adding `--execute`.

Each internal task declares `readPaths`, `writePaths`, dependencies, one check, and
`parallelSafe`. The plan rejects undeclared parallel read/write or write/write
overlap, so only genuinely independent work shares a wave. Each task uses one
current qualified local attempt with a short wall-clock limit. On failure, the
campaign automatically advances through the reviewed local, Luna, and Terra
ladder, provided each exact candidate is qualified and paid admission succeeds.
`--execute` authorizes that displayed ladder; each candidate is invoked at most
once. A campaign stays
dry-run unless `--execute` is supplied. Execution uses isolated worker and
integration worktrees, retains receipts below `.codex-factory/campaigns/`, and
leaves the accepted integration branch for owner inspection; it never merges
the owner branch.

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
visible but do not enter the subagent harness. Each result is bound to a
SHA-256 fingerprint over the candidate ID (provider and model), runtime version,
adapter version, declared capabilities, immutable model digest when the runtime
provides one, tier, reasoning effort, and the versioned role-harness
identifier. A failed
structured-write qualification does not erase a passing analysis qualification.
Mutating admission also requires the candidate to pass a derived structured-
reasoning benchmark; a protocol-only write response is insufficient. Current
admission comes from the latest record for the exact fingerprint and role in
the private qualification ledger. Historical results in tracked experiment
documents do not override a newer exact-fingerprint record.
Every executed qualification also retains a per-run bundle under
`.codex-factory/runs/` with its request, response events, diagnostics, final
message, timing, usage, and terminal result.

| Role policy | Required qualification | Minimum tier | Sandbox |
|---|---|---|---|
| `mechanical` | analysis | economy | read-only |
| `standard` | workspace write | economy | workspace-write |
| `review` | analysis | standard | read-only |
| `critical` | workspace write | premium | workspace-write |
| `local-read` | analysis | economy | read-only |

Qualified free local candidates are preferred. For a campaign, qualified Luna
and Terra are an ordered fallback after the one local attempt. The ordinary
`standard` route allows the economy-tier Luna candidate; critical work still
requires the premium route.

Campaign plans do not dispatch the `critical` route: Sol remains reserved for
coordination, while the campaign worker ladder is deliberately local, Luna,
then Terra. Split or escalate critical work outside this runner.

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

Task IDs are single-use after reservation. This standalone worker runner does
not retry automatically. The campaign runner instead creates one unique worker
task ID for each candidate route and advances through only the ladder shown in
its dry-run preview.

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
- one to four configured worker slots;
- one invocation per candidate route (a campaign task may advance through its
  previewed local, Luna, and Terra ladder);
- 30 minutes per worker.

Reservations are written under the dedicated usage ledger lock before launch and reconciled
when terminal usage arrives. If a worker crashes before reporting usage, its
reservation remains charged.

Codex currently reports token usage after the turn. Therefore the runner can
reject an unsafe launch and reject an over-budget result, but it cannot
interrupt a single model turn at an exact token count. The wall-clock timer and
owned process tree are the current hard runtime controls.

Local Ollama inference has no token-spend ceiling. It is bounded by wall time,
concurrency, attempts, and context/output safety. Prompt and output token counts
are recorded only as performance telemetry. Codex subscription usage allowances
and any future paid API cost budget are separate accounting classes.

## Process recovery

An interrupted process can leave a slot or ledger lock behind. The next runner
reclaims only a lock whose recorded supervisor PID is no longer alive; it never
removes a lock owned by a live process. Preserve the run evidence before manual
cleanup.

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
- exactly one invocation per worker task ID and one to four concurrent worker
  slots; a campaign uses a distinct worker task ID for each previewed route;
- known role qualifications, tiers, sandboxes, and reasoning efforts;
- a token reservation for every configured metered Codex candidate;
- runtime discovery, rather than a fixed Ollama allowlist.

Adding concurrency, retries, writable local routes, or a new provider changes
the safety model and requires new tests and design evidence.

## Frequently asked questions

### Who is the coordinator?

The active selected model in the top-level Codex task is the coordinator. It
keeps requirements, architecture, the private `campaign.json`, integration,
acceptance, and owner communication. Campaign workers are bounded leaves.

### Do I write `campaign.json`?

No. Give the coordinator a normal-language prompt, specification, or plan. It
creates the JSON privately under Factory-owned ignored state.

### Which qualification result is current?

The latest record for the exact role fingerprint controls admission. That
fingerprint hashes the candidate ID (provider and model), runtime version,
adapter version, declared capabilities, immutable model digest when available,
tier, reasoning effort, and the versioned role-harness identifier. Tracked
model ladders and bakeoff ledgers are historical evidence, not runtime
allowlists. Qualification
records and receipts remain private because they may contain host and task
details; the public site therefore makes no claim that a named model is
currently qualified on your host.

### Why can paid use exceed its reservation?

Codex reports usage only after a turn. The ledger can prevent an unsafe launch
and reject an over-reservation terminal result, but wall-clock supervision—not
the reservation—is the in-turn stop.

### Does `process_completed` mean the task passed?

No. It proves only the recorded process and artifact conditions. The
coordinator must inspect the result and run the acceptance checks.

### Why is Critical work not sent to campaign workers?

The campaign ladder is local, Luna, then Terra. Critical work stays with the
coordinator or is split into bounded non-Critical leaves; Sol is not a campaign
worker route.

### Where are private artifacts retained?

Coordinator intake, prompts, campaign plans, events, stderr, worker outputs,
usage, and integration receipts stay below ignored `.codex-factory/` state.
Review them before sharing because they may contain repository content.

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

Codex Factory is an experimental evidence-producing coordinator. It discovers
the real local inventory, dispatches bounded independent tasks, and preserves
an integration branch for inspection. It is not a PM control room, automatic
merge system, or hard real-time spend controller.
