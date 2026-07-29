# Operating contract

Every worker request must name:

- task ID and role;
- user-observable outcome;
- acceptance criteria and runnable checks;
- allowed repository and writable paths;
- exact route, sandbox or structured-write contract, and timeout;
- deterministic completion or failure artifact.

Workers are leaves. They do not delegate, broaden scope, merge, publish, install,
or make product decisions. The coordinator does not repeat assigned work.

The runner writes receipts under `.codex-factory/runs/` and campaigns under
`.codex-factory/campaigns/`. Worker slots bound concurrent execution; the paid
ledger lock rejects reused task IDs, rechecks aggregate budget, and persists the
reservation before launch. A terminal entry reconciles that reservation. Missing
or malformed paid usage closes the paid lane. Campaign tasks try one qualified
local model first, then explicit Luna and Terra fallbacks. Usage above the
reserved amount fails the result even though the CLI exposes it only at turn
completion.

Local Ollama work has no token reservation or aggregate token-spend budget.
Local tokens are telemetry. Wall time, concurrency, attempts, context/output
safety, allowlisted writes, and process cleanup are its enforced limits. Codex
subscription usage allowances and any future paid API budget are separate
accounting classes.

`process_completed` means only that the CLI exited successfully, reported usage,
and produced a nonempty final artifact. It is not an acceptance verdict. The
coordinator must independently inspect the artifact and required checks.

Promote only concise decision evidence into tracked documentation. Raw prompts,
events, stderr, and worker outputs remain ignored local run artifacts.
