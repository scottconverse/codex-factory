# Decisions

## 2026-07-29 — Start as a plugin-shaped standalone repository

The repository is itself a valid Codex plugin and contains one operator skill.
Marketplace installation and MCP exposure wait until the runner is useful.

## 2026-07-29 — Prefer existing Codex execution surfaces

Use `codex exec`, JSONL receipts, sandboxes, and explicit model selection instead
of recreating an agent runtime.

## 2026-07-29 — Close unsafe defaults

**Superseded for concurrency and admission locking on 2026-07-29.** The current
invariant permits one to four bounded worker slots. Dependency-ready tasks with
non-overlapping write paths may execute concurrently; each candidate route
remains single-attempt and non-recursive. Unknown paid usage prevents another
paid launch.

Reservations and duplicate-task checks serialize under the dedicated usage
ledger lock, separately from worker-slot ownership. Provider/accounting
mismatches are invalid configuration. A terminal CLI result is called
`process_completed`; acceptance remains a separate coordinator claim.

## 2026-07-29 — Terminal token accounting is insufficient for paid hard caps

A Terra review reserved 35,000 tokens but reported 241,086 only after the turn.
The runner rejected it as over budget and the aggregate paid lane no longer has
enough capacity for another configured route. Until Codex exposes an in-turn
limit, paid reservations are admission policy rather than a hard per-turn cap.

## 2026-07-29 — Keep the product decision open

**Superseded for the current product scope on 2026-07-29.** Codex Factory is
limited to the bounded coordinator/worker supervisor. A PM-facing governance or
control-room layer is out of scope unless the owner makes a new explicit
product decision with separate safety evidence.

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

> Superseded for matching current fingerprints by later exact-runtime,
> exact-adapter, exact-harness structured-write qualification. Historical
> failures remain evidence, but the latest record for the exact fingerprint and
> role controls admission.

`qwen3.5:9b` satisfied the embedded-context read-only smoke contract, but in the
writable worktree trial it only announced intended steps and made no tool call,
write, test, or commit. It therefore remains qualified only for narrow
read-only work with embedded context.

## 2026-07-29 — Price controls follow the execution tier

Local Ollama inference has no aggregate or per-task token-spend budget. Bound it
with wall time, concurrency, attempts, context/output safety, and process
cleanup; record tokens as telemetry. Codex subscription routes use measured
usage or quota allowances without claiming per-token billing. A future paid API
route must use hard cost/token admission and reconciliation.

## 2026-07-29 — Use structured files for local writable work

Free-form unified diffs from `qwen3.5:9b` were syntactically unreliable.
The local runner instead requests complete text for explicitly allowlisted
paths. The supervisor owns writes, Git staging, the derived diff, tests, and
commit creation.

`gemma4:12b` passed the first bounded fixture through this contract: 345 prompt
tokens, 125 output tokens, 50.4 seconds wall time, one changed path, a green
declared test, and commit `c2ae0d0ff2fb027b44d05b94c6556520aab6a5f8`.
Removing the edge-hyphen cleanup made the same test fail, proving the check was
sensitive to the required behavior.

## 2026-07-29 — Port the proven DevHarmonics worker-selection core

DevHarmonics already implements model discovery, exact-role qualification,
capability and permission admission, adaptive scoring, cheapest-at-established-
parity selection, health/quota fallback, and bounded local file tools.

Codex Factory copies and adapts the useful independent pieces rather than
depending on DevHarmonics: runtime discovery, capability admission, exact
model/runtime/harness fingerprints, role-scoped qualification, tier fit, and
qualified free-local-first selection. It does not copy the DevHarmonics
database, campaigns, product model, server, UI, or delivery machinery.
