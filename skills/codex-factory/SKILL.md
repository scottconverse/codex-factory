---
name: codex-factory
description: Route and supervise bounded software work across explicit Codex Sol, Terra, Luna, and qualified Ollama workers with token reservations, time limits, isolated scopes, and auditable receipts. Use when asked for a boss-and-worker coding fleet, budgeted AI delegation, model-tier routing, a Codex-native factory bakeoff, or proof that delegated work stayed within its assigned model and budget.
---

# Codex Factory

Keep the current agent as coordinator. Delegate only a bounded leaf task whose
acceptance criteria and writable scope are already known.

## Run

1. Read `references/operating-contract.md`.
2. Select one route from `factory.config.json`; never silently substitute.
3. Create a prompt file containing the task, acceptance criteria, allowed paths,
   required checks, and the instruction not to delegate.
4. Run `node scripts/run-worker.mjs ...` without `--execute`.
5. Inspect the printed model, provider, sandbox, reservation, timeout, and
   remaining aggregate budget.
6. Add `--execute` only when the dry run matches the approved task.
7. Treat `.codex-factory/runs/<run>/result.json` as the receipt. Inspect the
   worker artifact and checks independently before integrating it.

Use local routes only for read-only work until qualification evidence explicitly
permits more. Do not retry a failed task automatically or let the coordinator
duplicate work while the worker is running.

## Stop

Stop without launching when usage accounting is unknown, another worker owns the
lock, the route is absent, the repository is not Git-backed, the prompt is
missing acceptance criteria, or the reservation exceeds the remaining budget.
