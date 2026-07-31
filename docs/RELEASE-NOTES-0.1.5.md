# Codex Factory 0.1.5

Version 0.1.5 is a focused maintenance release for candidate qualification.

## Fixed

- Qualification checks now create the repository fixture they need and remove
  it when the check finishes.
- Each qualification check can run independently instead of relying on another
  check to leave compatible temporary state behind.

## Important boundaries

- A completed process is not automatic proof that task acceptance criteria pass.
- The integration branch is retained for owner review and is not merged
  automatically.
- Paid token reservations can reject an unsafe launch, but Codex reports usage
  after a turn, so wall-clock supervision remains the hard in-turn limit.
- Campaign plans do not dispatch Critical work; the top-level coordinator keeps
  that responsibility.
