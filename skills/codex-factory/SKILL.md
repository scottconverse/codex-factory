---
name: codex-factory
description: Discover, qualify, select, and supervise bounded software workers across Codex Sol, Terra, Luna, and installed Ollama models with pricing-tier controls, time limits, isolated scopes, and auditable receipts. Use when asked for a boss-and-worker coding fleet, budgeted AI delegation, model-tier routing, a Codex-native factory bakeoff, or proof that delegated work stayed within its assigned model and budget.
---

# Codex Factory

The currently selected model in the top-level Codex task is the coordinator.
Luna and Terra are fallback workers unless the owner deliberately selected one
as that top-level model. The owner supplies a
prompt, specification, or plan in normal language; the coordinator owns the
internal task plan. Never ask the owner to write Factory JSON.

## Run

1. Read `references/operating-contract.md`, inspect the current workspace, and
   identify the target Git repository. If there is no target repository, select
   a new, non-existent destination and bootstrap only that destination; never
   convert or overwrite a nonempty owner directory. Do not intake a repository
   with tracked owner changes: preserve them and use a clean worktree instead.
2. Create a private coordinator intake from the owner request:

   ```powershell
   node scripts/coordinator-intake.mjs --repository <existing-repo> --prompt "<owner request>"
   # or, for a new project:
   node scripts/coordinator-intake.mjs --bootstrap <empty-target> --prompt "<owner request>"
   ```

   The command stores the source and a reserved internal `campaign.json` path
   under Factory's own `.codex-factory/coordinator/` state. It is not an
   owner-facing plan format and does not write coordinator state into the target
   repository.
3. Read the intake source and inspect the target repository. Decide whether the
   request is one bounded task or benefits from decomposition. For every leaf,
   define acceptance criteria, minimal read/write scope, one runnable check,
   dependencies, and whether it can safely run in parallel. Keep architecture,
   integration, acceptance, and user communication in this top-level session.
   Treat the intake's immutable base commit as the inspected snapshot. If
   tracked files or `HEAD` change, stop and create a fresh intake rather than
   reusing a stale plan.
4. Read the intake's `sourcePath`, then write the internal valid campaign plan
   to its `planFile` with that text in the plan's `source` field. Do not
   dispatch `critical` work through the campaign: retain it in the coordinator
   or split it into safe bounded leaves.
5. Run `npm.cmd run fleet:qualify` to preview the complete current candidate and
   harness plan. Execute local qualification when current evidence is absent.
6. Run `node scripts/run-campaign.mjs --plan-file <internal-plan>` without
   `--execute`, inspect its selected local/Luna/Terra ladder, then add
   `--execute` only after the dry run matches the bounded plan.
7. Treat the campaign result as the worker receipt. Integrate only accepted
   commits, run the coordinator's acceptance checks, and obtain a fresh-context
   adversarial audit before accepting code.

For a qualified constrained local write, use
`node scripts/run-local-patch.mjs --task-file <task.json>` for preview and add
`--execute` only after inspection. The local task declares context paths,
write paths, a command/argument array, wall time, context/output safety limits,
and commit message. The runner selects any current structured-write-qualified
local candidate; an optional model field is a qualified override, not the pool.

Do not treat local token telemetry as spend admission. Do not retry the same
candidate route or let the coordinator duplicate work while a worker is
running. A reviewed campaign may automatically advance once through its
previewed local, Luna, and Terra ladder.

## Stop

Stop without launching when usage accounting is unknown, another worker owns the
lock, the route is absent, the repository is not Git-backed, the prompt is
missing acceptance criteria, or the reservation exceeds the remaining budget.
