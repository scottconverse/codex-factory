# Codex Factory

Codex Factory is a small, local-first control layer for running a frontier
coordinator with bounded Codex and local-model workers. It exists to determine
how much of an auditable AI software factory Codex already provides before a
larger product is built.

The first implementation is intentionally narrow:

- explicit Sol, Terra, Luna, or Ollama routes;
- dry-run by default and one worker at a time;
- durable paid and local pre-launch reservations with terminal reconciliation;
- wall-clock timeout with owned process-tree termination;
- JSONL, stderr, final-message, and usage receipts;
- no recursive delegation, automatic retries, MCP server, UI, or installation.

## Try a dry run

```powershell
node scripts/run-worker.mjs `
  --task-id inspect-repo `
  --role mechanical `
  --cwd C:\path\to\git-repository `
  --prompt-file C:\path\to\prompt.txt
```

Add `--execute` only after reviewing the route, reservation, permissions, and
remaining aggregate budget printed by the dry run.

Codex reports token usage at turn completion, so the initial runner can prevent
an over-reserved launch and reject an over-budget result, but cannot interrupt a
single turn at an exact token boundary. Wall-clock and process ownership are the
hard runtime controls.

A successful CLI exit is recorded as `process_completed`, not proof that the
assigned task passed acceptance. The coordinator must inspect the final artifact
and required checks before claiming task completion.

## Repository map

- `factory.config.json` — initial budget and model-routing policy.
- `scripts/run-worker.mjs` — supervised Codex CLI worker.
- `skills/codex-factory/` — operator workflow packaged for Codex.
- `docs/CAPABILITY-MATRIX.md` — build-versus-config comparison.
- `docs/EXPERIMENT-PLAN.md` — bounded bakeoff and decision exits.
- `.codex-factory/` — ignored local receipts and locks.

This repository is not installed into the personal Codex marketplace yet.
