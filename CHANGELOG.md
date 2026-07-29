# Changelog

All notable changes to Codex Factory are documented here.

## [Unreleased]

### Added

- Experimental two-worker concurrency smoke harness with explicit Ollama and
  OpenAI routes.
- Evidence-backed preferred worker ladder led by `qwen3.5:9b`, then Luna and
  Terra.
- Direct-Ollama local patch runner with structured full-file artifacts,
  allowlisted paths, isolated worktrees, declared checks, and commit receipts.
- Local pricing policy: wall time and capacity are enforced; token counts are
  telemetry rather than spend admission.

### Changed

- The default local route is `gemma4:12b`, qualified for the constrained
  structured-file patch contract. `qwen3.5:9b` remains read-only only.

## [0.1.0] - 2026-07-29

Initial experimental release.

### Added

- Explicit Sol, Terra, Luna, and Ollama worker routes.
- Dry-run-first supervised `codex exec` runner.
- Single-worker locking and single-use task IDs.
- Persistent token reservations and terminal usage reconciliation.
- Wall-clock timeout, interrupt handling, and owned process-tree cleanup.
- JSONL events, stderr, final-message, request, result, and usage receipts.
- Codex plugin metadata and operator skill.
- Product website, user manual, architecture guide, security policy, and
  GitHub Pages deployment workflow.

### Known limitations

- Codex reports usage after a turn, so per-run token reservations are admission
  policy rather than hard in-turn cutoffs.
- Only one worker may run at a time.
- A successful worker process is not automatic proof of task acceptance.
- Local models are restricted to read-only work until separately qualified.
- Campaigns, dependency graphs, a PM control room, and automatic integration are
  not included in this release.
