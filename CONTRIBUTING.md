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
npm.cmd run check
```

Build and validate the website:

```powershell
npm.cmd run site:build
npm.cmd run site:check
```

Code changes should include a focused test and an evidence-backed receipt.
Live model execution is never required for documentation-only contributions.

## Licensing

The current release is all rights reserved. Opening an issue or pull request
does not grant a license to the project or guarantee that a contribution will be
accepted. A separate contributor and project license policy may be adopted in a
future release.
