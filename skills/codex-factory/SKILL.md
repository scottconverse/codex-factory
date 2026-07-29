---
name: codex-factory
description: Discover, qualify, select, and supervise bounded software workers across Codex Sol, Terra, Luna, and installed Ollama models with pricing-tier controls, time limits, isolated scopes, and auditable receipts. Use when asked for a boss-and-worker coding fleet, budgeted AI delegation, model-tier routing, a Codex-native factory bakeoff, or proof that delegated work stayed within its assigned model and budget.
---

# Codex Factory

Keep the current agent as coordinator. Delegate only a bounded leaf task whose
acceptance criteria and writable scope are already known.

## Run

1. Read `references/operating-contract.md`.
2. Run `npm.cmd run fleet:qualify` to preview the complete current candidate and
   harness plan. Execute local qualification when current evidence is absent.
3. Select a role policy from `factory.config.json`; the runner chooses only from
   candidates with a current exact-role qualification.
4. Create a prompt file containing the task, acceptance criteria, allowed paths,
   required checks, and the instruction not to delegate.
5. Run `node scripts/run-worker.mjs ...` without `--execute`.
6. Inspect the printed model, provider, sandbox, reservation, timeout, and
   remaining aggregate budget.
7. Add `--execute` only when the dry run matches the approved task.
8. Treat `.codex-factory/runs/<run>/result.json` as the receipt. Hand the
   candidate and focused test evidence to the owner-selected outside auditor;
   the implementing coordinator does not self-audit this project.

For a qualified constrained local write, use
`node scripts/run-local-patch.mjs --task-file <task.json>` for preview and add
`--execute` only after inspection. The local task declares context paths,
write paths, a command/argument array, wall time, context/output safety limits,
and commit message. The runner selects any current structured-write-qualified
local candidate; an optional model field is a qualified override, not the pool.

Do not treat local token telemetry as spend admission. Do not retry a failed
task automatically or let the coordinator duplicate work while the worker is
running.

## Stop

Stop without launching when usage accounting is unknown, another worker owns the
lock, the route is absent, the repository is not Git-backed, the prompt is
missing acceptance criteria, or the reservation exceeds the remaining budget.
