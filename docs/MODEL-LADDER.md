# Worker model ladder

Last tested: 2026-07-29

> Historical evidence snapshot. Runtime routing does not use this document as
> an allowlist. The latest qualification record for the exact SHA-256
> fingerprint is authoritative. It covers candidate ID, runtime and adapter
> versions, capabilities, model digest when available, tier, reasoning effort,
> and the complete role harness; changing any component requires qualification
> again.

This was a narrow concurrency smoke test, not a general coding benchmark. Every
rung received the same two embedded repository excerpts and had to return two
exact JSON artifacts while both worker processes overlapped.

## Preferred ladder

1. `qwen3.5:9b` through Ollama for the roles supported by the latest exact
   fingerprint qualification. The historical trials below initially supported
   read-only work; later current-host evidence added structured writes.
2. `gpt-5.6-luna` at low reasoning for the first Codex fallback.
3. `gpt-5.6-terra` at low reasoning when Luna is unsuitable or the task needs a
   stronger implementation model.

Sol was not tested because this ladder targets free and lower-cost workers.

## Results

| Provider | Model | Result | Wall time | Reported tokens | Disposition |
|---|---|---:|---:|---:|---|
| Ollama | `qwen2.5:7b` | 0/2, then 1/2 | 123.5s, 75.9s | 10,437 total | Reject: unreliable final artifacts |
| Ollama | `JetBrains/mellum2-instruct-q4_k_m:latest` | 0/2 | 41.7s | unavailable | Reject: response stream disconnects |
| Ollama | `Seed-Coder-8B-Instruct` | 0/2 | 3.5s | unavailable | Reject: incompatible terminal response |
| Ollama | `qwen3.5:9b` | 2/2 | 122.7s | 4,385 | Qualify for this narrow local task |
| OpenAI | `gpt-5.6-luna` | 2/2 | 5.5s | 34,091 | Preferred paid fallback |
| OpenAI | `gpt-5.6-terra` | 2/2 | 6.4s | 36,461 | Stronger paid fallback |

Reported OpenAI totals include cached input as reported by Codex. They are usage
receipts, not a price calculation.

## What this proves

- Two independent `codex exec` processes can run with overlapping lifetimes.
- The supervisor can pin either Ollama or OpenAI models.
- Successful rungs produced independently validated artifacts.
- All tested child PIDs exited and the fleet-smoke lock was released.

## What this does not prove

- Local tool calling or autonomous repository inspection.
- Writable worktrees, code changes, tests, review, or integration.
- Parallel inference inside Ollama; the client processes overlapped, but Ollama
  may serialize model computation.
- Reliability across repeated campaigns or larger contexts.
- Hard in-turn token enforcement.

Run a preview:

```powershell
npm.cmd run fleet:smoke -- --provider ollama --model qwen3.5:9b
```

Add `--execute` only to run the two-worker smoke test.

## Writable follow-up

A later disposable-worktree trial requested two concurrent writes:

- `qwen3.5:9b` received a 30,000-token local reservation. It exited normally
  after 2,337 reported tokens but only announced intended steps; it made no
  tool call, write, test, or commit.
- `gpt-5.6-luna` received a 50,000-token paid reservation. It attempted the
  task, but the effective tool policy was read-only despite the requested
  `workspace-write` sandbox. It reported 120,868 tokens and produced no write,
  passing test, or commit.

Both processes overlapped and exited, but the integrated acceptance path did
not run because neither worker produced a candidate. At that point this kept
the ladder unchanged for read-only work and left writable coding unqualified.
Later exact-fingerprint qualification superseded that disposition; runtime
admission always follows the qualification ledger.

## Structured local patch qualification

The direct-Ollama patch path does not give the model shell or filesystem tools.
It accepts schema-bound complete file text, validates every path, writes inside
an isolated worktree, derives the Git diff, runs the declared check, and commits
only on green.

| Model | Result | Wall time | Token telemetry | Disposition |
|---|---:|---:|---:|---|
| `qwen3.5:9b` | 0/3 across early JSON-diff and structured-file trials | 26.6s, 37.4s, 17.8s | 419, 582, 389 | Historical failure; superseded for matching later exact fingerprints |
| `gemma4:12b` | 1/1 | 50.4s | 470 | Qualify for constrained structured-file patch tasks |

The accepted Gemma candidate changed one allowlisted file, passed the exact
test, and committed as `c2ae0d0ff2fb027b44d05b94c6556520aab6a5f8`.
A deliberate edge-handling mutation made the same test fail.
