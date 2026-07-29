# Changelog

All notable changes to Codex Factory are documented here.

## [Unreleased]

## [0.1.3] - 2026-07-29

### Fixed

- Clarified that premium Critical work is outside campaign-worker dispatch.

## [0.1.2] - 2026-07-29

### Added

- Local-first campaign coordination with dependency-safe parallel scheduling,
  isolated worktrees, integration receipts, and explicit local, Luna, Terra routing.
- Shared worker slots, serialized paid admission, cleanup receipts, and bounded
  local attempt deadlines.

### Changed

- Standard writable work may use a qualified economy-tier Luna fallback; campaign
  Critical work is intentionally rejected because Sol remains coordinator-only.

## [0.1.1] - 2026-07-29

### Added

- Dynamic discovery of every installed Ollama model and configured Codex
  candidate.
- Exact-runtime, exact-harness, role-scoped candidate qualification and
  automatic selection from the passing pool.
- Experimental two-worker concurrency smoke harness with explicit Ollama and
  OpenAI routes.
- Evidence-backed preferred worker ladder led by `qwen3.5:9b`, then Luna and
  Terra.
- Direct-Ollama local patch runner with structured full-file artifacts,
  allowlisted paths, isolated worktrees, declared checks, and commit receipts.
- Local pricing policy: wall time and capacity are enforced; token counts are
  telemetry rather than spend admission.

### Changed

- Fixed model routes became role/tier policies. Current qualification evidence,
  not a hardcoded ladder, decides which candidate runs.

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
