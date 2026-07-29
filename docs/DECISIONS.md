# Decisions

## 2026-07-29 — Start as a plugin-shaped standalone repository

The repository is itself a valid Codex plugin and contains one operator skill.
Marketplace installation and MCP exposure wait until the runner is useful.

## 2026-07-29 — Prefer existing Codex execution surfaces

Use `codex exec`, JSONL receipts, sandboxes, and explicit model selection instead
of recreating an agent runtime.

## 2026-07-29 — Close unsafe defaults

Worker execution is explicit, serial, single-attempt, budget-reserved, and
non-recursive. Unknown paid usage prevents another paid launch.

Reservations and duplicate-task checks occur while holding the worker lock.
Provider/accounting mismatches are invalid configuration. A terminal CLI result
is called `process_completed`; acceptance remains a separate coordinator claim.

## 2026-07-29 — Terminal token accounting is insufficient for paid hard caps

A Terra review reserved 35,000 tokens but reported 241,086 only after the turn.
The runner rejected it as over budget and the aggregate paid lane no longer has
enough capacity for another configured route. Until Codex exposes an in-turn
limit, paid reservations are admission policy rather than a hard per-turn cap.

## 2026-07-29 — Keep the product decision open

The bakeoff may end with Codex alone, this thin plugin, a PM-facing governance
layer, or continued DevHarmonics development. Evidence decides.
