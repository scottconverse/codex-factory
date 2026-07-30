# Capability matrix

| Factory capability | Codex-native path | Initial disposition |
|---|---|---|
| Frontier coordinator | Desktop, CLI, SDK, App Server | Reuse |
| Explicit Sol/Terra/Luna worker | `codex exec -m` | Reuse through supervisor |
| Local worker | `codex exec --oss --local-provider ollama` | Reuse after qualification |
| Native subagent threads | Multi-agent tools and custom agents | Evaluate; current V2 routing is unreliable |
| Isolated writes | Git worktrees plus sandbox | Reuse |
| Machine-readable receipts | `codex exec --json` | Reuse and normalize |
| Token budgets | Usage events plus supervisor policy | Thin layer required |
| Process lifecycle | Child PID and process-tree supervision | Thin layer required |
| Durable campaigns and dependency graph | Factory campaign plan and isolated integration worktree | Implemented locally |
| Deterministic automatic role policy | Additive task contract plus Factory-owned permission/risk combiner | Implemented; off by default |
| Learned task-difficulty routing | Pinned RouteLLM source plus local Factory adapter | Integration and evaluation tooling implemented; no validated checkpoint shipped |
| Classification evidence | Pre-routing receipt with input, policy, checkpoint, and threshold hashes | Implemented locally |
| Product-owner approval policy | Prompts, permissions, hooks, skills | Evaluate |
| Cross-provider qualification history | Partial provider/model configuration | Likely differentiated |
| PM-facing Control Room | Desktop task/subagent views are partial | Out of current scope; requires a new explicit product decision and safety evidence |

The bakeoff must replace assumptions in this table with execution receipts.
The current product scope is the bounded coordinator/worker supervisor only;
historical platform options are not active roadmap commitments.
