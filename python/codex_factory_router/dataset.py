"""Reviewed Factory outcome dataset validation and capability-label derivation."""

from __future__ import annotations

import re

_HASH = re.compile(r"^sha256:[0-9a-f]{64}$")
_LABELS = {"weak_sufficient", "strong_required", "neither_sufficient"}
_SPLITS = {"train", "validation", "holdout"}


def _acceptance(outcome, name):
    if not isinstance(outcome, dict) or not isinstance(outcome.get("acceptancePassed"), bool):
        raise ValueError(f"{name} outcome is missing acceptance evidence")
    if not isinstance(outcome.get("processStatus"), str) or not outcome["processStatus"]:
        raise ValueError(f"{name} outcome is missing process status")
    return outcome["acceptancePassed"]


def derive_capability_label(weak_outcome, strong_outcome):
    weak_passed = _acceptance(weak_outcome, "Weak")
    strong_passed = _acceptance(strong_outcome, "Strong")
    if weak_passed and strong_passed:
        return "weak_sufficient"
    if not weak_passed and strong_passed:
        return "strong_required"
    if not weak_passed and not strong_passed:
        return "neither_sufficient"
    raise ValueError("Weak-pass/strong-fail outcome is anomalous and must be excluded and investigated")


def validate_dataset(records):
    if not isinstance(records, list) or not records:
        raise ValueError("Factory dataset must be a non-empty array")
    seen_tasks = set()
    repository_splits = {}
    for index, record in enumerate(records):
        label = f"Dataset record {index}"
        if not isinstance(record, dict) or record.get("schemaVersion") != 1:
            raise ValueError(f"{label} schemaVersion must be 1")
        task_hash = record.get("taskHash")
        if not isinstance(task_hash, str) or not _HASH.fullmatch(task_hash):
            raise ValueError(f"{label} taskHash is invalid")
        if task_hash in seen_tasks:
            raise ValueError(f"{label} duplicates taskHash {task_hash}")
        seen_tasks.add(task_hash)
        if not isinstance(record.get("encodedTask"), str) or not record["encodedTask"].startswith("[FACTORY_TASK_V1]\n"):
            raise ValueError(f"{label} encodedTask is invalid")
        if record.get("accessFamily") not in {"read", "write"}:
            raise ValueError(f"{label} accessFamily is invalid")
        if not isinstance(record.get("riskTriggers"), list) or not all(isinstance(item, str) for item in record["riskTriggers"]):
            raise ValueError(f"{label} riskTriggers are invalid")
        pair = record.get("candidatePair")
        if not isinstance(pair, dict) or set(pair) != {"weak", "strong"} or not all(
            isinstance(pair[key], str) and pair[key] for key in pair
        ):
            raise ValueError(f"{label} candidatePair is invalid")
        expected = derive_capability_label(record.get("weakOutcome"), record.get("strongOutcome"))
        if record.get("label") not in _LABELS or record["label"] != expected:
            raise ValueError(f"{label} label does not match acceptance outcomes")
        if not isinstance(record.get("reviewedBy"), str) or not record["reviewedBy"].strip():
            raise ValueError(f"{label} reviewedBy is required")
        receipts = record.get("sourceReceiptHashes")
        if not isinstance(receipts, list) or not receipts or not all(
            isinstance(item, str) and _HASH.fullmatch(item) for item in receipts
        ):
            raise ValueError(f"{label} sourceReceiptHashes are invalid")
        repository = record.get("repositoryGroup")
        if not isinstance(repository, str) or not repository:
            raise ValueError(f"{label} repositoryGroup is required")
        if not isinstance(record.get("taskFamily"), str) or not record["taskFamily"]:
            raise ValueError(f"{label} taskFamily is required")
        split = record.get("split")
        if split not in _SPLITS:
            raise ValueError(f"{label} split is invalid")
        prior_split = repository_splits.setdefault(repository, split)
        if prior_split != split:
            raise ValueError(f"Factory dataset repository leakage: {repository} appears in {prior_split} and {split}")
    return records
