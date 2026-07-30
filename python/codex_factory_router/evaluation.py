"""Deterministic threshold calibration and evaluation for Factory role routing."""

from __future__ import annotations

import math
import statistics

_ROLES = {"local-read", "mechanical", "review", "standard", "critical"}
_ROLE_STRENGTH = {
    "local-read": 0,
    "mechanical": 0,
    "review": 1,
    "standard": 0,
    "critical": 1,
}


def _probability(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError(f"{label} must be a finite number from zero through one")
    return float(value)


def _validate_row(row):
    if not isinstance(row, dict):
        raise ValueError("Evaluation row must be an object")
    if row.get("accessFamily") not in {"read", "write"}:
        raise ValueError("Evaluation accessFamily is invalid")
    for name in ["rulesRole", "policyFloor", "reviewedRole"]:
        if row.get(name) not in _ROLES:
            raise ValueError(f"Evaluation {name} is invalid")
    _probability(row.get("difficultyScore"), "Evaluation difficultyScore")
    latency = row.get("classificationLatencyMs")
    if isinstance(latency, bool) or not isinstance(latency, (int, float)) or latency < 0:
        raise ValueError("Evaluation classificationLatencyMs is invalid")
    for name in ["weakTokens", "strongTokens"]:
        value = row.get(name)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(f"Evaluation {name} is invalid")
    if not isinstance(row.get("riskTriggers"), list) or not all(isinstance(item, str) for item in row["riskTriggers"]):
        raise ValueError("Evaluation riskTriggers are invalid")


def _predict(row, review_threshold, critical_threshold):
    if row["policyFloor"] == "critical":
        return "critical"
    score = row["difficultyScore"]
    if row["accessFamily"] == "write":
        return "critical" if score >= critical_threshold else "standard"
    return "review" if score >= review_threshold else row["rulesRole"]


def evaluate_router(rows, *, review_threshold, critical_threshold):
    review_threshold = _probability(review_threshold, "Review threshold")
    critical_threshold = _probability(critical_threshold, "Critical threshold")
    if review_threshold > critical_threshold:
        raise ValueError("Review threshold must not exceed critical threshold")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Evaluation rows must be a non-empty array")

    confusion = {}
    critical_by_trigger = {}
    critical_false_negative_tasks = 0
    under = 0
    over = 0
    predicted_strong = 0
    predicted_critical = 0
    selected_tokens = 0
    always_strong_tokens = 0
    latencies = []
    squared_errors = []
    for row in rows:
        _validate_row(row)
        predicted = _predict(row, review_threshold, critical_threshold)
        reviewed = row["reviewedRole"]
        confusion.setdefault(reviewed, {})
        confusion[reviewed][predicted] = confusion[reviewed].get(predicted, 0) + 1
        predicted_strength = _ROLE_STRENGTH[predicted]
        reviewed_strength = _ROLE_STRENGTH[reviewed]
        under += predicted_strength < reviewed_strength
        over += predicted_strength > reviewed_strength
        is_strong = predicted in {"review", "critical"}
        predicted_strong += is_strong
        predicted_critical += predicted == "critical"
        selected_tokens += row["strongTokens"] if is_strong else row["weakTokens"]
        always_strong_tokens += row["strongTokens"]
        latencies.append(row["classificationLatencyMs"])
        target = 1.0 if reviewed in {"review", "critical"} else 0.0
        squared_errors.append((row["difficultyScore"] - target) ** 2)
        if reviewed == "critical" and predicted != "critical":
            critical_false_negative_tasks += 1
            triggers = row["riskTriggers"] or ["UNSPECIFIED"]
            for trigger in triggers:
                critical_by_trigger[trigger] = critical_by_trigger.get(trigger, 0) + 1

    ordered_latency = sorted(latencies)
    p95_index = max(0, math.ceil(0.95 * len(ordered_latency)) - 1)
    count = len(rows)
    return {
        "schemaVersion": 1,
        "count": count,
        "confusionMatrix": confusion,
        "criticalFalseNegatives": critical_false_negative_tasks,
        "criticalFalseNegativesByTrigger": critical_by_trigger,
        "underClassificationRate": under / count,
        "overClassificationRate": over / count,
        "operatorReviewRate": predicted_critical / count,
        "strongLanePercentage": predicted_strong / count,
        "estimatedTokenSavings": always_strong_tokens - selected_tokens,
        "medianClassificationLatencyMs": statistics.median(ordered_latency),
        "p95ClassificationLatencyMs": ordered_latency[p95_index],
        "calibrationError": sum(squared_errors) / count,
    }


def _highest_threshold_meeting_recall(rows, predicate, required_recall):
    positives = [row for row in rows if predicate(row)]
    if not positives:
        return 1.0
    candidates = sorted({0.0, 1.0, *[float(row["difficultyScore"]) for row in rows]})
    feasible = []
    for threshold in candidates:
        recalled = sum(row["difficultyScore"] >= threshold for row in positives) / len(positives)
        if recalled >= required_recall:
            feasible.append(threshold)
    if not feasible:
        raise ValueError("No threshold satisfies the required recall")
    return max(feasible)


def calibrate_thresholds(
    rows,
    *,
    name,
    checkpoint_fingerprint,
    dataset_fingerprint,
    required_review_recall,
):
    if not isinstance(rows, list) or not rows:
        raise ValueError("Calibration rows must be a non-empty array")
    for row in rows:
        _validate_row(row)
    if not isinstance(name, str) or not name:
        raise ValueError("Threshold-set name is required")
    for fingerprint in [checkpoint_fingerprint, dataset_fingerprint]:
        if not isinstance(fingerprint, str) or not fingerprint.startswith("sha256:") or len(fingerprint) != 71:
            raise ValueError("Calibration fingerprints must use sha256")
    required_review_recall = _probability(required_review_recall, "Required review recall")
    review_threshold = _highest_threshold_meeting_recall(
        [row for row in rows if row["accessFamily"] == "read"],
        lambda row: row["reviewedRole"] == "review",
        required_review_recall,
    )
    critical_threshold = _highest_threshold_meeting_recall(
        [row for row in rows if row["accessFamily"] == "write" and row["policyFloor"] != "critical"],
        lambda row: row["reviewedRole"] == "critical",
        1.0,
    )
    if review_threshold > critical_threshold:
        review_threshold = critical_threshold
    metrics = evaluate_router(
        rows,
        review_threshold=review_threshold,
        critical_threshold=critical_threshold,
    )
    return {
        "schemaVersion": 1,
        "name": name,
        "routerCheckpointFingerprint": checkpoint_fingerprint,
        "datasetFingerprint": dataset_fingerprint,
        "reviewThreshold": review_threshold,
        "criticalEscalationThreshold": critical_threshold,
        "metrics": {
            "criticalFalseNegatives": metrics["criticalFalseNegatives"],
            "underClassificationRate": metrics["underClassificationRate"],
            "overClassificationRate": metrics["overClassificationRate"],
            "requiredReviewRecall": required_review_recall,
        },
    }
