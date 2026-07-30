# Role classification

Codex Factory can classify a bounded task before it discovers candidates,
builds an attempt ladder, or acquires a worker slot. Classification is
experimental, local, and disabled by default.

The checked-in defaults are:

```json
{
  "mode": "off",
  "router": "rules"
}
```

This feature does not replace role-scoped qualification or candidate
selection. It supplies an effective Factory role to those existing controls.

## Authority stays with Factory

Classification has two independent inputs:

1. Factory policy owns permissions and named risk triggers.
2. An optional RouteLLM-derived classifier estimates task difficulty.

The task contract—not a classifier—declares `accessFamily` as `read` or
`write`. Factory rejects read contracts with write paths and write contracts
without a write path. RouteLLM can recommend a stronger capability lane, but
it cannot:

- change read access into write access;
- expand declared paths;
- lower a deterministic Critical floor;
- choose a provider or model;
- bypass exact-role qualification, budgets, or process supervision; or
- dispatch a campaign task classified as Critical.

Factory currently recognizes these Critical trigger codes:

- `AUTH_OR_SECRETS`
- `MONEY`
- `PERSISTED_DATA`
- `SECURITY_OR_PRIVACY`
- `CONCURRENCY_OR_ORDER`
- `INSTALL_OR_DEPLOY`
- `IRREVERSIBLE`

Trigger matching applies to write tasks. Read-only inspection, review, or
documentation does not become Critical merely because it mentions the same
domain.

Rules-only `auto` is deliberately asymmetric: an `auto` write is always
classified `critical`, even when no trigger phrase matches. This avoids
pretending that a finite vocabulary can prove a write is low risk. Operators
who have reviewed the task may continue to request the explicit `standard`
role; shadow policy can still escalate that declaration when a named trigger
matches. Auto read tasks remain useful for choosing among local-read,
mechanical, and review lanes.

## Modes

| Mode | Explicit role | `role: auto` |
|---|---|---|
| `off` | Existing behavior is preserved | Rejected |
| `shadow` | Proposed role is recorded; explicit route is preserved | Preview only; no candidate is selected |
| `enforce` | Policy and configured classifier may escalate the role | Effective classified role is used |

Any campaign classification that resolves to `critical` stops before candidate
selection. Single-worker dry runs may preview a qualified Critical route; worker
execution remains separately opt-in.

## Rules-only workflow

Use the standalone command with the tracked example:

```powershell
npm.cmd run classify:role -- `
  --task-file examples/classification-task.json `
  --classification-mode enforce `
  --receipt-directory .codex-factory/examples/classification
```

Rules-only mode does not need Python or RouteLLM. It proves the task contract,
deterministic floor, risk triggers, role combination, and receipt path.
Receipts are immutable: choose a new `--receipt-directory` for each run.

Single-worker classification adds explicit task-contract fields:

```powershell
node scripts/run-worker.mjs `
  --task-id inspect-repo `
  --role auto `
  --classification-mode enforce `
  --classification-router rules `
  --access-family read `
  --task-type inventory `
  --cwd . `
  --prompt-file examples/inventory.prompt.md
```

`inventory`, `mechanical`, and `review` are read task types.
`implementation` is a write task type. In the currently available rules-only
router, `role: auto` plus `implementation` stops as Critical by design.

Campaign `auto` tasks use the same additive fields:

```json
{
  "id": "fix-parser",
  "role": "auto",
  "accessFamily": "write",
  "taskType": "implementation"
}
```

## Optional RouteLLM environment

RouteLLM dependencies remain outside the Node dependency tree. On Windows:

```powershell
.\scripts\setup-router.ps1
```

The script:

1. selects Python 3.11 or 3.12;
2. creates `.codex-factory/router-venv/`;
3. upgrades pip to a reviewed hash-locked version, then installs the
   hash-locked router dependency set;
4. installs the pinned vendored RouteLLM source and Factory adapter;
5. performs an offline import smoke test; and
6. records runtime and source fingerprints in
   `.codex-factory/router-runtime.json`.

Dry-run Factory commands never install packages. To uninstall every
setup-created router artifact, close any router process and run this from the
repository root:

```powershell
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue .codex-factory/router-venv
Remove-Item -Force -ErrorAction SilentlyContinue .codex-factory/router-packages.txt, .codex-factory/router-runtime.json
```

This intentionally preserves operator-installed
`.codex-factory/router-models/` checkpoints. Remove that directory separately
only when those models are no longer needed.

## Learned router gate

No Factory-trained checkpoint is shipped or enabled by this change. Do not use
RouteLLM's Chatbot Arena checkpoints or thresholds as evidence for Factory
coding roles.

The reusable `FactoryDifficultyRouter` keeps RouteLLM's
`calculate_strong_win_rate(prompt)` interface and interprets the result as the
probability that a stronger Factory capability lane is required. Learned
enforcement requires all of the following operator-supplied artifacts:

- a local Factory-specific sequence-classification checkpoint;
- its configured SHA-256 fingerprint;
- a calibrated threshold JSON file stored under the checkpoint's
  `thresholds/` directory;
- the threshold file's configured SHA-256 fingerprint;
- a threshold record bound to the exact checkpoint and reviewed dataset; and
- a threshold metric recording zero Critical false negatives.

Inference is one-shot, offline, time bounded, and output bounded. Node validates
every response field and stops on timeout, nonzero exit, malformed output,
revision mismatch, checkpoint mismatch, threshold mismatch, or an out-of-range
score. Enforce mode is fail closed and does not retry.

## Data, calibration, and evaluation

Factory-owned Python modules provide:

- stable task encoding with path, URL, and credential-shaped value redaction;
- reviewed outcome validation;
- capability labels based on acceptance evidence, never process completion;
- repository-group split validation to prevent train/holdout leakage;
- deterministic threshold calibration; and
- per-role confusion, Critical false negatives by trigger,
  under/over-classification, review rate, strong-lane share, estimated token
  savings, latency, and calibration error.

`weak pass / strong fail` records are anomalous and excluded for investigation.
Records missing acceptance evidence are rejected. The repository contains
tests and schemas, not fabricated owner-reviewed outcomes.

Learned opt-in enforcement remains blocked until maintainers collect and review
the required dataset, evaluate disagreement samples, and satisfy the release
gate. Aggregate accuracy alone cannot pass that gate.

## Receipts

`classification.json` is written before routing and records:

- requested role, access family, and task type;
- deterministic floor and named risk triggers;
- encoded-task hash and encoder version;
- RouteLLM revision, score, checkpoint fingerprint, threshold fingerprint, and
  calibrated thresholds when a learned router is used;
- effective and execution roles; and
- classifier availability or failure evidence.

Classification and worker receipts are private local state. They may contain
owner instructions or diagnostics and should not be published without review.

## RouteLLM attribution

Codex Factory vendors RouteLLM 0.2.0 at commit
`0b64fdafe049e596a3f5657c219329f24af24198` from
[LMSYS Org's RouteLLM repository](https://github.com/lm-sys/RouteLLM) and
maintains the integration fork at
[scottconverse/RouteLLM, `codex-factory-integration`](https://github.com/scottconverse/RouteLLM/tree/codex-factory-integration)
(initial integration commit
`60bc73c7e31b7c931271ae44a8543a8b082ba163`).
Both RouteLLM and Codex Factory use Apache License 2.0.

RouteLLM is associated with the paper “RouteLLM: Learning to Route LLMs with
Preference Data” by Isaac Ong, Amjad Almahairi, Vincent Wu, Wei-Lin Chiang,
Tianhao Wu, Joseph E. Gonzalez, M. Waleed Kadous, and Ion Stoica
([arXiv:2406.18665](https://arxiv.org/abs/2406.18665)). The upstream
documentation acknowledges collaboration with Anyscale.

Complete license retention, modification notices, non-endorsement language,
and update instructions are in
[`third_party/routellm/NOTICE.md`](../third_party/routellm/NOTICE.md).
