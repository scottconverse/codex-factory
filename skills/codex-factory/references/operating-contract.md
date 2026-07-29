# Operating contract

Every worker request must name:

- task ID and role;
- user-observable outcome;
- acceptance criteria and runnable checks;
- allowed repository and writable paths;
- exact route, sandbox, token reservation, and timeout;
- deterministic completion or failure artifact.

Workers are leaves. They do not delegate, broaden scope, merge, publish, install,
or make product decisions. The coordinator does not repeat assigned work.

The runner writes local receipts under `.codex-factory/runs/`. Under the
single-worker lock it rejects reused task IDs, rechecks the aggregate budget,
and persists the reservation before launch. A terminal entry reconciles that
reservation. Missing or malformed paid usage closes the paid lane. Usage above
the reserved amount fails the result even though the CLI exposes it only at turn
completion. A timeout or supervisor interrupt terminates and reaps the exact
owned child process tree. If reaping cannot be confirmed, the lock remains as a
stop condition for operator investigation.

`process_completed` means only that the CLI exited successfully, reported usage,
and produced a nonempty final artifact. It is not an acceptance verdict. The
coordinator must independently inspect the artifact and required checks.

Promote only concise decision evidence into tracked documentation. Raw prompts,
events, stderr, and worker outputs remain ignored local run artifacts.
