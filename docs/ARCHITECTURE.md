# Architecture

## Purpose

Codex Factory adds a thin control plane around existing Codex CLI execution. It
reuses provider authentication, model execution, sandboxes, JSONL events, and
local-model support instead of implementing a second agent runtime.

## Runtime flow

```text
Owner prompt/specification
    |
    v
Primary Codex coordinator
    |-- inspect existing repository or bootstrap an explicit empty target
    |-- produce private bounded dependency plan
    v
Campaign runner
    |
    | task ID + role + repository + internal source
    v
Runner preflight
    |-- validate configuration and prompt contract
    |-- confirm Git repository
    |-- classify task before candidate discovery/selection (when enabled)
    |-- preview exact provider/model/sandbox command
    v
Worker-slot and ledger locks
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

### Role classification boundary

`scripts/factory-role-policy.mjs` normalizes the additive task contract and
owns read/write access, deterministic role floors, and named Critical risk
triggers. `scripts/factory-role-classifier.mjs` owns stable redacted encoding,
the bounded Python child process, strict response validation, role combination,
and `classification.json`.

```text
bounded task contract
    |-- accessFamily + taskType + paths
    v
Factory deterministic policy
    |-- permission family
    |-- minimum role
    |-- named Critical triggers
    +-----------------------------+
                                  |
optional local RouteLLM adapter   |
    |-- difficulty score          |
    |-- checkpoint fingerprint    |
    |-- threshold fingerprint     |
    +-----------------------------+
                                  v
                         Factory role combiner
                                  |
                                  v
                    existing qualification + selector
```

Rules-only mode has no Python dependency. The optional learned path invokes
`python -m codex_factory_router.adapter` once with a bounded JSON request.
Inference runs from `.codex-factory/router-venv/`, sets supported Hugging Face
libraries offline, installs a Python audit hook that denies socket operations,
and has no shell or repository tools. The shared process supervisor enforces
wall time plus stdout/stderr limits and owns cleanup.

The learned response is accepted only when its schema, task ID, RouteLLM
revision, checkpoint fingerprint, threshold fingerprint, threshold values, and
score all match configuration. Threshold JSON is stored below the checkpoint
but excluded from the model fingerprint to avoid a circular digest; the
threshold record separately binds itself to that model fingerprint and its
reviewed dataset fingerprint.

Classification precedes candidate discovery, attempt-ladder construction, and
worker-slot acquisition. It may escalate capability but cannot change the
permission family or lower the deterministic floor. Campaigns stop on any
Critical classification. No Factory-trained checkpoint is currently shipped,
so learned enforcement remains gated; the checked-in mode is `off`.

### Campaign coordinator and supervisor

`scripts/coordinator-intake.mjs` is the boundary between an owner request and
the internal campaign format. It copies the request into Factory-owned ignored
local state, reserves a plan path, and either validates an existing Git
repository or safely bootstraps an explicit empty target. It never writes
coordinator state into the target repository, plans, routes, or launches a
worker itself.

The primary Codex session reads that intake, inspects the repository, chooses
whether decomposition is useful, and creates the validated dependency plan.
`scripts/run-campaign.mjs` then dispatches only independent non-overlapping
tasks and integrates accepted commits into an isolated branch. Its ladder is
one qualified Ollama attempt, then explicit Luna, then Terra. It retains the
integration result for owner inspection and never auto-merges the owner branch.

`scripts/run-worker.mjs` is a dependency-free Node.js process supervisor. It
constructs an explicit `codex exec` invocation, sends the prompt through stdin,
and owns the launched process tree.

`scripts/run-local-patch.mjs` calls Ollama directly. The model receives only
declared file contents and returns complete text for allowlisted files. It
cannot select commands or filesystem paths outside the task contract.

`scripts/factory-fleet.mjs` ports the proven DevHarmonics candidate pattern:
runtime discovery; SHA-256 fingerprints over candidate ID, runtime and adapter
versions, capabilities, model digest when available, tier, reasoning effort,
and the versioned role-harness identifier; role-scoped qualification; a
structured-reasoning benchmark for mutating work; capability admission; tier fit; and
free-local-first selection.
`scripts/qualify-fleet.mjs` exercises every worker-capable discovered candidate;
embedding-only inventory remains visible but is not treated as a subagent.

### Durable local state

`.codex-factory/` contains worker slots, an append-only usage ledger, campaign
receipts, classification receipts, the optional router environment and
checkpoints, qualification run bundles, and per-run evidence. Campaign
acceptance checks use the same owned process-tree supervisor as model execution
and retain their own check receipt. A dead-PID slot or ledger lock is reclaimed
only by a later acquisition; live owners are never removed. The directory is
intentionally outside version control.

### Operator skill

`skills/codex-factory/` packages the dry-run, execution, and stop conditions as
a Codex skill. The checkout does not install itself. Open the Factory checkout
as the workspace for the top-level Codex task and explicitly tell the selected
model to read `skills/codex-factory/SKILL.md` completely and use it to
coordinate the owner request. That selected model is the coordinator.

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
- The task contract grants access; learned classification cannot grant write
  access, expand scope, choose a provider, or lower a policy floor.
- RouteLLM source and dependencies are pinned third-party code. Locally
  downloaded checkpoints are third-party executable data and require explicit
  fingerprints before learned routing can be configured.

## Failure policy

The system fails closed where evidence is missing:

- an invalid task contract prevents launch;
- an auto role in off mode, a declaration conflict, or an unavailable learned
  classifier in enforce mode prevents candidate selection;
- classifier timeout, excess output, nonzero exit, malformed JSON, or artifact
  mismatch prevents candidate selection;
- a campaign task classified as Critical prevents campaign dispatch;
- tracked owner changes prevent coordinator intake, so an isolated campaign
  cannot silently omit or overwrite uncommitted work;
- all live worker slots prevent launch;
- a reused task ID prevents launch;
- insufficient aggregate budget prevents launch;
- unknown paid usage prevents later paid admission;
- an unreaped process preserves the lock;
- nonempty output and zero exit are still reported only as process completion.

## Not included

- automatic merge to an owner branch;
- semantic acceptance verification;
- remote control plane or web application;
- MCP server;
- cross-provider performance history.
