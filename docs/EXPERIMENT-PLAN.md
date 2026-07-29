# Codex-native factory bakeoff

## Budget

- 250,000 aggregate paid-model tokens.
- 1,000,000 aggregate local-model tokens.
- One worker at a time.
- One attempt per task.
- Thirty minutes maximum per worker.
- Stop paid execution when usage is missing or malformed.

Token reservations are persisted under the single-worker lock before launch and
reconciled at the terminal usage event. A crashed reservation remains charged
and its task ID cannot be reused. The initial Codex CLI surface does not expose
an in-turn hard token interrupt; a result that exceeds its reservation fails the
factory gate and may consume most of the aggregate ceiling before it can stop.

## Trials

1. Luna repository inventory with structured output.
2. Qualified local model performing the same read-only inventory.
3. Terra implementing one isolated ordinary change in a disposable worktree.
4. Terra-high reviewing the exact candidate from fresh task context.
5. Sol resolving one architectural question without doing worker implementation.
6. Two sequential packages proving recovery and dependency handoff.

## Measurements

Record acceptance result, exact checks, elapsed time, human intervention,
input/cached/output tokens, context growth, process cleanup, retry count, and
whether the coordinator duplicated assigned work.

## Exit

Classify every relevant DevHarmonics requirement as native, configurable, thin
integration, existing ecosystem, or genuinely missing. Recommend one outcome:
Codex-only, thin plugin, PM governance layer, or continued full product.
