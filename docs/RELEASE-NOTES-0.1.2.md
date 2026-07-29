# Codex Factory 0.1.2

## What changed

- Added the owner-facing campaign coordinator: validated plans, dependency waves,
  isolated worker worktrees, and an integration branch that is never auto-merged.
- Routes qualified local workers first, then qualified Luna and Terra fallbacks.
- Added bounded worker slots, serialized paid admission, durable cleanup receipts,
  source/write path containment checks, and attempt-wide local deadlines.

## Important boundaries

- Campaign plans reject premium Critical work; Sol remains coordinator-only.
- Paid usage is admission and reconciliation evidence, not an in-turn token stop.
- A completed process is not semantic acceptance; the coordinator still inspects
  results and declared checks.
