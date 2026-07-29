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

## 2026-07-29 — Treat every paid invocation as factory spend

A disposable writable-worktree experiment invoked Luna directly after the
production ledger had already closed its 250,000-token paid lane. That bypass
was invalid even though the experiment used an isolated fixture and declared a
per-worker reservation: the CLI has no in-turn cutoff, and the failed worker
reported 120,868 tokens against a 50,000 reservation.

Every future paid invocation, including probes, reviews, smoke tests, and
disposable experiments, must be admitted through one aggregate ledger. No paid
execution resumes without a new explicit aggregate budget.

## 2026-07-29 — Do not claim writable Codex workers on this host

In a disposable Git worktree, `codex exec --sandbox workspace-write` produced a
model-visible and tool-enforced read-only environment. Luna could read the
fixture but could not write, run the requested test, or commit. A separate
no-tool probe also reported `read-only`.

The official non-interactive contract says `--sandbox workspace-write` should
allow edits, so the observed host behavior conflicts with the documented CLI
surface. Until that environment mismatch is resolved, writable Codex workers
are unavailable here. `--dangerously-bypass-approvals-and-sandbox` is not an
acceptable workaround for routine workers.

## 2026-07-29 — Keep the local 9B route read-only

`qwen3.5:9b` satisfied the embedded-context read-only smoke contract, but in the
writable worktree trial it only announced intended steps and made no tool call,
write, test, or commit. It therefore remains qualified only for narrow
read-only work with embedded context.
