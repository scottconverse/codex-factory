# RouteLLM attribution and local integration notice

Codex Factory includes source code from
[RouteLLM](https://github.com/lm-sys/RouteLLM), an open-source framework for
serving and evaluating large-language-model routers developed by the LMSYS
organization and RouteLLM contributors.

## Included upstream revision

- Upstream repository: https://github.com/lm-sys/RouteLLM
- Codex Factory maintenance fork:
  https://github.com/scottconverse/RouteLLM/tree/codex-factory-integration
- Initial maintained integration commit:
  `60bc73c7e31b7c931271ae44a8543a8b082ba163`
  (`codex-factory-integration` branch)
- Included commit: `0b64fdafe049e596a3f5657c219329f24af24198`
- Upstream package version: `0.2.0`
- License: Apache License 2.0
- Upstream license copy: [`LICENSE`](LICENSE)

The upstream revision did not contain a separate `NOTICE` file. This local
notice supplements, and does not replace or modify, the Apache License 2.0.
Codex Factory retains upstream copyright, patent, trademark, and attribution
notices in the included source.

## Research and developer attribution

RouteLLM is based on the following research:

> Isaac Ong, Amjad Almahairi, Vincent Wu, Wei-Lin Chiang, Tianhao Wu,
> Joseph E. Gonzalez, M. Waleed Kadous, and Ion Stoica.
> “RouteLLM: Learning to Route LLMs with Preference Data.” 2024.
> arXiv:2406.18665. https://arxiv.org/abs/2406.18665

The upstream project documentation also acknowledges that the research was
conducted in collaboration with Anyscale.

Codex Factory’s Factory-specific task encoding, permission and risk policy,
adapter, training data, calibration, evaluation, thresholds, checkpoints, and
receipts are separate local integration work. They must not be represented as
results produced, reviewed, endorsed, or validated by LMSYS, the paper authors,
RouteLLM contributors, or Anyscale.

## Local modifications

The source snapshot contains the following Codex Factory compatibility change:

- `routellm/routers/similarity_weighted/utils.py`,
  `routellm/routers/matrix_factorization/model.py`, and
  `routellm/routers/routers.py` lazily construct the OpenAI client. This keeps
  importing local-only routers from requiring OpenAI credentials or initializing
  network-capable client state. The embedding-backed routers retain their
  original behavior when they are invoked.

Modified upstream files carry a prominent modification notice as required by
Apache License 2.0 section 4(b). Factory-owned integration code remains outside
this directory unless it is generally reusable by RouteLLM. The maintained
fork branch contains the reusable binary router, acceptance-evidence helpers,
tests, and integration documentation; Factory permission and risk policy stays
in Codex Factory.

## Update procedure

1. Review the target RouteLLM revision, release notes, dependency changes,
   license, source notices, and any newly added `NOTICE` file.
2. Import the exact reviewed revision without its Git metadata.
3. Update `REVISION`, this notice, dependency locks, and source fingerprints.
4. Reapply or port documented local modifications.
5. Run the RouteLLM import, adapter, offline-inference, schema, license,
   calibration, evaluation, and Codex Factory regression checks.
6. Record the exact upstream and Codex Factory commits in the release evidence.
