# Worker model ladder

Last tested: 2026-07-29

This is a narrow concurrency smoke test, not a general coding benchmark. Every
rung received the same two embedded repository excerpts and had to return two
exact JSON artifacts while both worker processes overlapped.

## Preferred ladder

1. `qwen3.5:9b` through Ollama for free, read-only, embedded-context mechanical
   work.
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
not run because neither worker produced a candidate. This keeps the ladder
unchanged for read-only work and leaves writable coding unqualified.
