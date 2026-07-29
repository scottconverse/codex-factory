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

## Security boundaries in 0.1.1

- Worker execution is opt-in through `--execute`.
- Sandboxing is delegated to the selected Codex CLI sandbox.
- The runner supervises the child process tree but is not a security sandbox.
- Route configuration is trusted local input.
- Raw worker receipts may contain repository content and should not be
  published without review.
