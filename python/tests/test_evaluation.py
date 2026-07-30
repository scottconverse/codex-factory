import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))

from codex_factory_router.dataset import derive_capability_label, validate_dataset
from codex_factory_router.evaluation import calibrate_thresholds, evaluate_router
from codex_factory_router.fingerprints import checkpoint_fingerprint
from codex_factory_router.thresholds import load_threshold_set


def outcome(passed):
    return {"processStatus": "process_completed", "acceptancePassed": passed}


def record(task_hash, repository, split, weak, strong, **overrides):
    value = {
        "schemaVersion": 1,
        "taskHash": f"sha256:{task_hash * 64}",
        "encodedTask": "[FACTORY_TASK_V1]\noperation: write\n",
        "accessFamily": "write",
        "riskTriggers": [],
        "candidatePair": {"weak": "ollama/local", "strong": "openai/terra"},
        "weakOutcome": outcome(weak),
        "strongOutcome": outcome(strong),
        "label": derive_capability_label(outcome(weak), outcome(strong)),
        "reviewedBy": "reviewer-1",
        "sourceReceiptHashes": [f"sha256:{'f' * 64}"],
        "repositoryGroup": repository,
        "taskFamily": "parser",
        "split": split,
    }
    value.update(overrides)
    return value


class DatasetTests(unittest.TestCase):
    def test_labels_require_acceptance_evidence_not_process_completion(self):
        self.assertEqual(derive_capability_label(outcome(True), outcome(True)), "weak_sufficient")
        self.assertEqual(derive_capability_label(outcome(False), outcome(True)), "strong_required")
        self.assertEqual(derive_capability_label(outcome(False), outcome(False)), "neither_sufficient")
        with self.assertRaisesRegex(ValueError, "anomalous"):
            derive_capability_label(outcome(True), outcome(False))
        with self.assertRaisesRegex(ValueError, "acceptance evidence"):
            derive_capability_label({"processStatus": "process_completed"}, outcome(True))

    def test_dataset_rejects_repository_leakage_and_unreviewed_or_mislabeled_records(self):
        valid = [record("a", "repo-a", "train", False, True), record("b", "repo-b", "holdout", True, True)]
        self.assertEqual(len(validate_dataset(valid)), 2)
        leaked = [record("a", "repo-a", "train", False, True), record("b", "repo-a", "holdout", True, True)]
        with self.assertRaisesRegex(ValueError, "repository leakage"):
            validate_dataset(leaked)
        unreviewed = record("c", "repo-c", "train", False, True, reviewedBy="")
        with self.assertRaisesRegex(ValueError, "reviewedBy"):
            validate_dataset([unreviewed])
        mislabeled = record("d", "repo-d", "train", False, True, label="weak_sufficient")
        with self.assertRaisesRegex(ValueError, "label"):
            validate_dataset([mislabeled])


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {
                "taskHash": f"sha256:{'1' * 64}",
                "accessFamily": "read",
                "rulesRole": "local-read",
                "policyFloor": "local-read",
                "reviewedRole": "local-read",
                "difficultyScore": 0.10,
                "riskTriggers": [],
                "classificationLatencyMs": 10,
                "weakTokens": 100,
                "strongTokens": 500,
            },
            {
                "taskHash": f"sha256:{'2' * 64}",
                "accessFamily": "read",
                "rulesRole": "mechanical",
                "policyFloor": "mechanical",
                "reviewedRole": "review",
                "difficultyScore": 0.60,
                "riskTriggers": [],
                "classificationLatencyMs": 20,
                "weakTokens": 120,
                "strongTokens": 600,
            },
            {
                "taskHash": f"sha256:{'3' * 64}",
                "accessFamily": "write",
                "rulesRole": "standard",
                "policyFloor": "standard",
                "reviewedRole": "critical",
                "difficultyScore": 0.92,
                "riskTriggers": ["AUTH_OR_SECRETS"],
                "classificationLatencyMs": 30,
                "weakTokens": 200,
                "strongTokens": 800,
            },
            {
                "taskHash": f"sha256:{'4' * 64}",
                "accessFamily": "write",
                "rulesRole": "standard",
                "policyFloor": "standard",
                "reviewedRole": "standard",
                "difficultyScore": 0.40,
                "riskTriggers": [],
                "classificationLatencyMs": 40,
                "weakTokens": 250,
                "strongTokens": 900,
            },
        ]

    def test_calibration_binds_fingerprints_and_meets_zero_critical_false_negative_constraint(self):
        artifact = calibrate_thresholds(
            self.rows,
            name="factory-role-thresholds-fixture",
            checkpoint_fingerprint=f"sha256:{'a' * 64}",
            dataset_fingerprint=f"sha256:{'b' * 64}",
            required_review_recall=1.0,
        )
        self.assertEqual(artifact["reviewThreshold"], 0.6)
        self.assertEqual(artifact["criticalEscalationThreshold"], 0.92)
        self.assertEqual(artifact["metrics"]["criticalFalseNegatives"], 0)
        self.assertEqual(artifact["routerCheckpointFingerprint"], f"sha256:{'a' * 64}")

    def test_evaluation_reports_per_role_confusion_trigger_failures_cost_and_latency(self):
        report = evaluate_router(self.rows, review_threshold=0.6, critical_threshold=0.92)
        self.assertEqual(report["criticalFalseNegatives"], 0)
        self.assertEqual(report["confusionMatrix"]["review"]["review"], 1)
        self.assertEqual(report["confusionMatrix"]["critical"]["critical"], 1)
        self.assertEqual(report["underClassificationRate"], 0.0)
        self.assertEqual(report["overClassificationRate"], 0.0)
        self.assertEqual(report["medianClassificationLatencyMs"], 25.0)
        self.assertEqual(report["p95ClassificationLatencyMs"], 40)
        self.assertGreater(report["estimatedTokenSavings"], 0)

    def test_threshold_set_is_fingerprinted_and_bound_to_the_model_checkpoint(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkpoint = Path(temporary)
            (checkpoint / "model.bin").write_bytes(b"model")
            fingerprint = checkpoint_fingerprint(checkpoint)
            threshold_root = checkpoint / "thresholds"
            threshold_root.mkdir()
            artifact = {
                "schemaVersion": 1,
                "name": "factory-role-thresholds-v1",
                "routerCheckpointFingerprint": fingerprint,
                "datasetFingerprint": f"sha256:{'b' * 64}",
                "reviewThreshold": 0.55,
                "criticalEscalationThreshold": 0.9,
                "metrics": {"criticalFalseNegatives": 0},
            }
            threshold_path = threshold_root / "factory-role-thresholds-v1.json"
            threshold_path.write_text(json.dumps(artifact), encoding="utf-8")

            loaded = load_threshold_set(checkpoint, artifact["name"], fingerprint)

            self.assertEqual(loaded.review_threshold, 0.55)
            self.assertRegex(loaded.fingerprint, r"^sha256:[0-9a-f]{64}$")
            self.assertEqual(checkpoint_fingerprint(checkpoint), fingerprint)
            artifact["routerCheckpointFingerprint"] = f"sha256:{'c' * 64}"
            threshold_path.write_text(json.dumps(artifact), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "another checkpoint"):
                load_threshold_set(checkpoint, artifact["name"], fingerprint)


if __name__ == "__main__":
    unittest.main()
