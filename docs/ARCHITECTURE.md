# Architecture

## Purpose

Codex Factory adds a thin control plane around existing Codex CLI execution. It
reuses provider authentication, model execution, sandboxes, JSONL events, and
local-model support instead of implementing a second agent runtime.

## Runtime flow

```text
Coordinator
    |
    | task ID + role + repository + prompt
    v
Runner preflight
    |-- validate configuration and prompt contract
    |-- confirm Git repository
    |-- preview exact provider/model/sandbox command
    v
Single-worker lock
    |-- reject duplicate task ID
    |-- recheck aggregate budget
    |-- persist reservation
    v
codex exec child process
    |-- prompt through stdin
    |-- JSONL events and stderr captured
    |-- timeout/interrupt owns exact process tree
    v
Terminal reconciliation
    |-- usage + final artifact + exit state
    |-- process_completed / failed / timed_out / over_budget
    v
Coordinator acceptance
```

The local patch path avoids autonomous model tools:

```text
Task JSON + declared context
    -> direct Ollama structured generation
    -> validate file paths and text artifacts
    -> write only inside generated Git worktree
    -> stage and derive real Git diff
    -> run declared check
    -> commit only on green
```

## Components

### Configuration

`factory.config.json` is the operator-controlled routing and budget policy.
Provider/accounting mismatches are rejected.

### Supervisor

`scripts/run-worker.mjs` is a dependency-free Node.js process supervisor. It
constructs an explicit `codex exec` invocation, sends the prompt through stdin,
and owns the launched process tree.

`scripts/run-local-patch.mjs` calls Ollama directly. The model receives only
declared file contents and returns complete text for allowlisted files. It
cannot select commands or filesystem paths outside the task contract.

`scripts/factory-fleet.mjs` ports the proven DevHarmonics candidate pattern:
runtime discovery, exact model/runtime/harness fingerprints, role-scoped
qualification, a structured-reasoning benchmark for mutating work, capability
admission, tier fit, and free-local-first selection.
`scripts/qualify-fleet.mjs` exercises every worker-capable discovered candidate;
embedding-only inventory remains visible but is not treated as a subagent.

### Durable local state

`.codex-factory/` contains an execution lock, an append-only usage ledger, and
per-run evidence. It is intentionally outside version control.

### Operator skill

`skills/codex-factory/` packages the dry-run, execution, and stop conditions as
a Codex skill. Version 0.1.1 does not install the skill automatically.

## Trust boundaries

- The coordinator is responsible for requirements and acceptance.
- The runner trusts the checked-in configuration and local Codex installation.
- Codex or Ollama performs model inference and tool execution.
- The Codex sandbox controls filesystem permissions; the runner is not a
  replacement sandbox.
- Operating-system process controls are the final wall-clock stop mechanism.
- Terminal usage events are trusted for accounting because no in-turn usage
  signal is currently exposed.
- Local token counts are telemetry, not financial admission controls.

## Failure policy

The system fails closed where evidence is missing:

- an invalid task contract prevents launch;
- an existing lock prevents launch;
- a reused task ID prevents launch;
- insufficient aggregate budget prevents launch;
- unknown paid usage prevents later paid admission;
- an unreaped process preserves the lock;
- nonempty output and zero exit are still reported only as process completion.

## Not included in 0.1.1

- parallel scheduling;
- campaign persistence and dependency graphs;
- automatic worktree creation or merges;
- semantic acceptance verification;
- remote control plane or web application;
- MCP server;
- cross-provider performance history.
