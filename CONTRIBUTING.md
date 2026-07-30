# Contributing

Codex Factory is an early experimental project. Bug reports, reproducible
failure cases, documentation corrections, and design discussion are welcome
through GitHub issues.

## Before proposing code

1. Open an issue describing the user-visible problem and expected outcome.
2. Keep changes bounded to one capability or defect.
3. Do not broaden model permissions, paid-token ceilings, concurrency, retries,
   or process-control behavior without an explicit design decision.
4. Do not include secrets or raw `.codex-factory/` run artifacts.

## Development

Requirements:

- Node.js 24 or newer
- Git
- Codex CLI for live worker execution
- Ollama only when testing the local route

Run the repository checks:

```powershell
npm.cmd run verify
```

Build and validate the website:

```powershell
npm.cmd run site:build
npm.cmd run site:check
```

Code changes should include a focused test and an evidence-backed receipt.
Live model execution is never required for documentation-only contributions.

## Licensing

Codex Factory is licensed under the [Apache License 2.0](LICENSE). Unless you
explicitly state otherwise, contributions intentionally submitted for inclusion
in the project are provided under the same license, as described in Section 5.
