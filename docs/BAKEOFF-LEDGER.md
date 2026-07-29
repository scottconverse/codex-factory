# Bakeoff ledger

## 2026-07-29

| Task | Route | Result | Input | Cached input | Output | Total | Elapsed |
|---|---|---:|---:|---:|---:|---:|---:|
| `local-inventory-smoke` | Ollama `qwen3.5:4b` | Contract failure: no final artifact | 2,050 | 0 | 2,046 | 4,096 local | 3m 04s |
| `terra-initial-adversary` | `gpt-5.6-terra`, high, read-only | Over 35,000 reservation; review retained | 233,022 | 196,608 | 8,064 | 241,086 paid | 2m 42s |

Paid aggregate ceiling: 250,000. Paid usage: 241,086. Unreserved remainder:
8,914, which is below every configured paid route reservation. No further paid
worker may launch under this experiment configuration.

The Terra review found five release blockers. The baseline repairs are limited
to lock-scoped budget admission, durable reservations and unique task IDs,
provider/accounting validation, bounded kill-and-reap handling, and honest
process-versus-task completion semantics.
