# Codex Factory 0.1.4

Version 0.1.4 turns a normal owner prompt, specification, or plan into a private,
reviewable Factory campaign without requiring the owner to author JSON.

## Added

- Prompt-driven coordinator intake for an existing clean repository.
- Safe bootstrap intake for one explicit destination that does not yet exist.
- Coordinator-owned private campaign planning with the inspected commit pinned
  before preview or execution.

## Changed

- Qualified local workers are attempted first for bounded campaign tasks, with
  Luna and then Terra available as the reviewed paid fallback order.
- Independent, non-overlapping tasks may share configured worker slots while
  paid admission remains serialized.
- Local qualification and campaign acceptance checks retain complete request,
  process, timing, diagnostic, usage, and terminal-result receipts.
- Public onboarding now begins with the owner prompt and clearly identifies the
  selected top-level Codex model as the coordinator.

## Fixed

- Windows delete-pending lock contention and temporary-fixture cleanup use
  bounded retries while preserving persistent failures.
- Required checks own and reap their process trees before reporting completion.
- Desktop and responsive site links and controls meet the 44-by-44-pixel target
  contract without overlap or page overflow.

## Important boundaries

- A completed process is not automatic proof that task acceptance criteria pass.
- The integration branch is retained for owner review and is not merged
  automatically.
- Paid token reservations can reject an unsafe launch, but Codex reports usage
  after a turn, so wall-clock supervision remains the hard in-turn limit.
- Campaign plans do not dispatch Critical work; the top-level coordinator keeps
  that responsibility.
