import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import torch
from transformers import BertConfig, BertForSequenceClassification, BertTokenizer

ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = ROOT / "python"
ROUTELLM_REVISION = "0b64fdafe049e596a3f5657c219329f24af24198"

sys.path.insert(0, str(PYTHON_ROOT))
from codex_factory_router.fingerprints import checkpoint_fingerprint


def create_tiny_checkpoint(checkpoint):
    vocab = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]", "change", "parser"]
    vocab_path = checkpoint / "vocab.txt"
    vocab_path.write_text("\n".join(vocab) + "\n", encoding="utf-8")
    tokenizer = BertTokenizer(vocab_file=str(vocab_path), do_lower_case=True)
    tokenizer.save_pretrained(checkpoint)

    config = BertConfig(
        vocab_size=len(vocab),
        hidden_size=8,
        num_hidden_layers=1,
        num_attention_heads=2,
        intermediate_size=16,
        num_labels=2,
    )
    model = BertForSequenceClassification(config)
    with torch.no_grad():
        for parameter in model.parameters():
            parameter.zero_()
        model.classifier.bias.copy_(torch.tensor([0.0, 2.0]))
    model.save_pretrained(checkpoint)
    (checkpoint / "calibration.json").write_text(
        json.dumps({"schemaVersion": 1, "type": "identity"}),
        encoding="utf-8",
    )


class AdapterTests(unittest.TestCase):
    def test_scores_a_local_checkpoint_without_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            temporary_path = Path(temporary)
            checkpoint = temporary_path / "checkpoint"
            checkpoint.mkdir()
            create_tiny_checkpoint(checkpoint)
            fingerprint = checkpoint_fingerprint(checkpoint)
            threshold_root = checkpoint / "thresholds"
            threshold_root.mkdir()
            threshold_path = threshold_root / "factory-role-thresholds-v1.json"
            threshold_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "name": "factory-role-thresholds-v1",
                        "routerCheckpointFingerprint": fingerprint,
                        "datasetFingerprint": f"sha256:{'b' * 64}",
                        "reviewThreshold": 0.55,
                        "criticalEscalationThreshold": 0.9,
                        "metrics": {"criticalFalseNegatives": 0},
                    }
                ),
                encoding="utf-8",
            )
            request_path = temporary_path / "request.json"
            request_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "taskId": "fix-parser",
                        "encodedTask": "[FACTORY_TASK_V1]\noperation: write\ninstructions:\nchange parser",
                        "router": "factory_bert",
                        "checkpoint": str(checkpoint),
                        "thresholdSet": "factory-role-thresholds-v1",
                        "timeoutSeconds": 20,
                    }
                ),
                encoding="utf-8",
            )
            environment = os.environ.copy()
            environment["PYTHONPATH"] = str(PYTHON_ROOT)
            for name in ["OPENAI_API_KEY", "OPENAI_ADMIN_KEY"]:
                environment.pop(name, None)

            result = subprocess.run(
                [sys.executable, "-m", "codex_factory_router.adapter", "--request", str(request_path)],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            response = json.loads(result.stdout)
            self.assertEqual(response["schemaVersion"], 1)
            self.assertEqual(response["taskId"], "fix-parser")
            self.assertEqual(response["router"], "factory_bert")
            self.assertGreater(response["difficultyScore"], 0.8)
            self.assertLessEqual(response["difficultyScore"], 1.0)
            self.assertEqual(response["scoreMeaning"], "probability_stronger_lane_required")
            self.assertRegex(response["checkpointFingerprint"], r"^sha256:[0-9a-f]{64}$")
            self.assertEqual(response["checkpointFingerprint"], fingerprint)
            self.assertEqual(response["thresholdSet"], "factory-role-thresholds-v1")
            self.assertEqual(response["thresholdFingerprint"], "sha256:" + __import__("hashlib").sha256(threshold_path.read_bytes()).hexdigest())
            self.assertEqual(response["reviewThreshold"], 0.55)
            self.assertEqual(response["criticalEscalationThreshold"], 0.9)
            self.assertEqual(response["criticalFalseNegatives"], 0)
            self.assertEqual(response["routeLLMRevision"], ROUTELLM_REVISION)
            self.assertGreaterEqual(response["durationMs"], 0)
            self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
