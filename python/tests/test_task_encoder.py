import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))

from codex_factory_router.task_encoder import encode_task


class TaskEncoderTests(unittest.TestCase):
    def test_matches_cross_language_golden_fixture(self):
        fixture = json.loads(
            (ROOT / "test" / "fixtures" / "classification-task.json").read_text(encoding="utf-8")
        )
        expected = (
            ROOT / "test" / "fixtures" / "classification-task.txt"
        ).read_text(encoding="utf-8").rstrip() + "\n"

        encoded = encode_task(fixture)

        self.assertEqual(encoded.text, expected)
        self.assertEqual(
            encoded.sha256,
            "sha256:" + hashlib.sha256(expected.encode("utf-8")).hexdigest(),
        )
        self.assertEqual(encoded.version, "1")
        self.assertNotIn("scott", encoded.text)
        self.assertNotIn("topsecret", encoded.text)

    def test_rejects_traversal_and_oversized_output(self):
        fixture = json.loads(
            (ROOT / "test" / "fixtures" / "classification-task.json").read_text(encoding="utf-8")
        )
        fixture["readPaths"] = ["../private"]
        with self.assertRaisesRegex(ValueError, "relative repository path"):
            encode_task(fixture)

        fixture["readPaths"] = ["src/parser.mjs"]
        fixture["instructions"] = "x" * 2_000
        with self.assertRaisesRegex(ValueError, "exceeds 1000 bytes"):
            encode_task(fixture, max_input_bytes=1_000)


if __name__ == "__main__":
    unittest.main()
