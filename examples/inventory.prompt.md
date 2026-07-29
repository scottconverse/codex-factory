You are a bounded leaf worker. Do not delegate or spawn other workers.

Task: inventory the repository and return a concise JSON object describing its
languages, manifests, test commands, and five highest-risk areas. Do not edit.

Acceptance criteria

- Output is valid JSON.
- Every risk names an exact file or directory.
- Claims come from repository evidence rather than assumptions.

Allowed paths

- Read the supplied repository only.
- Write no repository files.

Required checks

- Confirm the repository root with `git rev-parse --show-toplevel`.
- Confirm every named path exists.

Do not delegate

Complete this task yourself and return one final JSON object.
