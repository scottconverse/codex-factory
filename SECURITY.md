# Security policy

## Supported versions

Codex Factory is experimental. Only the latest published release receives
security fixes.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities involving command execution,
process control, sandbox escape, secrets, or paid-usage bypass.

Use GitHub's private vulnerability reporting for this repository when
available. Include:

- affected version and operating system;
- exact configuration and route;
- minimal reproduction;
- expected and observed process or accounting behavior;
- whether credentials, files, or paid usage were exposed.

Do not include live API keys, authentication tokens, or private run artifacts.

## Current security boundaries

- Worker execution is opt-in through `--execute`.
- Sandboxing is delegated to the selected Codex CLI sandbox.
- The runner supervises the child process tree but is not a security sandbox.
- Route configuration is trusted local input.
- Qualification, worker slots, and paid admission use private local state and
  locks. Missing or malformed paid usage closes the paid lane.
- Coordinator intake and campaign receipts are private local artifacts that may
  contain owner prompts and repository content.
- Campaign writes occur in isolated worktrees. The integration branch remains
  separate and is never merged into the owner branch automatically.
- Bootstrap accepts only an explicit destination that does not already exist.
- Direct local writes are restricted to task-declared allowlisted files; the
  supervisor applies model-proposed content and runs the declared check.
- Classification is disabled by default. The task contract—not RouteLLM—grants
  read or write access. Classification cannot expand paths or lower a named
  Critical risk floor.
- Optional RouteLLM inference uses a project-local Python environment, offline
  library settings, a socket-denying Python audit hook, bounded input and
  output, an owned process tree, and pinned checkpoint and threshold
  fingerprints. It receives encoded task metadata, not repository file
  contents.
- Learned enforce mode fails closed on classifier timeout, process failure,
  malformed output, revision or fingerprint mismatch, threshold mismatch,
  out-of-range scores, or a nonzero recorded Critical false-negative metric.
- Router checkpoints are third-party executable data. Download and inspect
  them during setup, keep them in ignored local state, and never enable learned
  enforcement from an unreviewed or mutable checkpoint.
- Raw worker receipts may contain repository content and should not be
  published without review.

Classification receipts and Python diagnostics can contain owner instructions
or local paths after a failure. Treat them with the same care as worker
receipts. See [`docs/ROLE-CLASSIFICATION.md`](docs/ROLE-CLASSIFICATION.md) for
the classifier trust boundary and artifact contract.

Architecture and current trust boundaries are documented in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Reports about concurrency,
ledger admission, worktree isolation, coordinator state, or local structured
writes should identify the exact commit as well as the latest published version.
