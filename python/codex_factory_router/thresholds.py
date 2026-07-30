"""Load and fingerprint a calibrated threshold set bound to one checkpoint."""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

_NAME = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,127}$")
_HASH = re.compile(r"^sha256:[0-9a-f]{64}$")


@dataclass(frozen=True)
class ThresholdSet:
    name: str
    checkpoint_fingerprint: str
    dataset_fingerprint: str
    review_threshold: float
    critical_escalation_threshold: float
    critical_false_negatives: int
    fingerprint: str


def _probability(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError(f"{label} must be a finite number from zero through one")
    return float(value)


def load_threshold_set(checkpoint: Path, name: str, checkpoint_fingerprint: str):
    if not isinstance(name, str) or not _NAME.fullmatch(name):
        raise ValueError("Factory threshold-set name is invalid")
    path = checkpoint / "thresholds" / f"{name}.json"
    try:
        raw = path.read_bytes()
    except FileNotFoundError as error:
        raise ValueError(f"Factory router checkpoint is missing threshold set {name}") from error
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Factory threshold set is not valid UTF-8 JSON") from error
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("Factory threshold-set schemaVersion must be 1")
    if value.get("name") != name:
        raise ValueError("Factory threshold-set name does not match its request")
    bound_fingerprint = value.get("routerCheckpointFingerprint")
    if bound_fingerprint != checkpoint_fingerprint:
        raise ValueError("Factory threshold set names another checkpoint fingerprint")
    dataset_fingerprint = value.get("datasetFingerprint")
    if not isinstance(dataset_fingerprint, str) or not _HASH.fullmatch(dataset_fingerprint):
        raise ValueError("Factory threshold-set dataset fingerprint is invalid")
    review = _probability(value.get("reviewThreshold"), "Factory review threshold")
    critical = _probability(value.get("criticalEscalationThreshold"), "Factory critical threshold")
    if review > critical:
        raise ValueError("Factory review threshold must not exceed the critical threshold")
    critical_false_negatives = value.get("metrics", {}).get("criticalFalseNegatives")
    if isinstance(critical_false_negatives, bool) or not isinstance(critical_false_negatives, int) or critical_false_negatives < 0:
        raise ValueError("Factory threshold-set critical false-negative metric is invalid")
    return ThresholdSet(
        name=name,
        checkpoint_fingerprint=bound_fingerprint,
        dataset_fingerprint=dataset_fingerprint,
        review_threshold=review,
        critical_escalation_threshold=critical,
        critical_false_negatives=critical_false_negatives,
        fingerprint=f"sha256:{hashlib.sha256(raw).hexdigest()}",
    )
