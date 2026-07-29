# Bakeoff ledger

## 2026-07-29

| Task | Route | Result | Input | Cached input | Output | Total | Elapsed |
|---|---|---:|---:|---:|---:|---:|---:|
| `local-inventory-smoke` | Ollama `qwen3.5:4b` | Contract failure: no final artifact | 2,050 | 0 | 2,046 | 4,096 local | 3m 04s |
| `terra-initial-adversary` | `gpt-5.6-terra`, high, read-only | Over 35,000 reservation; review retained | 233,022 | 196,608 | 8,064 | 241,086 paid | 2m 42s |
| `local-writable-slugify` | Ollama `qwen3.5:9b`, low, workspace-write requested | Failed: announced work but made no tool call, write, test, or commit | 2,050 | 0 | 287 | 2,337 local | 1m 27s |
| `luna-writable-clamp` | `gpt-5.6-luna`, low, workspace-write requested | Failed: effective tool policy was read-only; no write, test, or commit; over 50,000 reservation | 119,840 | 98,560 | 1,028 | 120,868 paid | 31s |
| `luna-sandbox-probe` | `gpt-5.6-luna`, low, no tools requested | Reported effective sandbox as `read-only` despite `--sandbox workspace-write` | 13,711 | 8,960 | 6 | 13,717 paid | 3s |

The first two rows were admitted by the production runner. At that point, paid
usage was 241,086 and the unreserved remainder under the 250,000 ceiling was
8,914, below every configured paid route reservation.

The writable experiment then made a direct `codex exec` call outside the
production runner because the runner is intentionally serial and read-only for
the local route. That bypass was an experiment-control error: it escaped the
closed aggregate paid lane and added 134,585 reported paid tokens. The direct
experiment must not be counted as evidence that budget admission worked.

Known model-ladder paid runs recorded separately in `MODEL-LADDER.md` add
34,091 Luna tokens and 36,461 Terra tokens. Across the entries in this ledger
and those model-ladder runs, known reported paid usage is 446,223 tokens.
Cached input remains included because these are provider-reported usage
receipts, not a price estimate.

No further paid worker may launch until a new explicit aggregate experiment
budget is established and every paid path, including disposable tests, passes
through the same admission ledger.

The Terra review found five release blockers. The baseline repairs are limited
to lock-scoped budget admission, durable reservations and unique task IDs,
provider/accounting validation, bounded kill-and-reap handling, and honest
process-versus-task completion semantics.

The two writable workers had overlapping lifetimes and both child processes
exited. That proves concurrent process supervision only. It does not prove
writable worktrees, implementation, commits, integration, or review.
