You are an independent, bounded reviewer. Do not delegate or spawn workers.

Task: adversarially review this repository's initial supervised-worker runner.
Focus only on defects that could waste paid tokens, leave worker processes alive,
misroute model/provider/sandbox settings, corrupt accounting, or falsely report
completion. Inspect the implementation, tests, configuration, and operating
contract. Do not edit.

Acceptance criteria

- Return a concise report with findings ordered by severity.
- Every finding names exact files and includes a reproducible failure path.
- Separate release-blocking defects from optional follow-up work.
- If no release-blocking defect remains, say so explicitly.
- Do not repeat a finding without new evidence.

Allowed paths

- Read this repository only.
- Write no repository files.
- Ignore the generated `.codex-factory` run artifacts except when checking the
  documented receipt format.

Required checks

- Run `npm.cmd run check`.
- Inspect `scripts/run-worker.mjs`, `factory.config.json`, `AGENTS.md`,
  `README.md`, `docs/`, and `test/`.
- Confirm the worker command uses the selected model, provider, reasoning effort,
  sandbox, working directory, ephemeral mode, JSONL events, and stdin prompt.
- Confirm the single-worker lock is released on every handled terminal path.

Do not delegate

Complete this review yourself. Stop after one pass and one final report.
