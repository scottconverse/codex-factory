import math
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import torch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))

from codex_factory_router.factory_router import FactoryDifficultyRouter


class FakeTokenizer:
    def __call__(self, prompt, **kwargs):
        self.prompt = prompt
        self.kwargs = kwargs
        return {}


class FakeModel:
    def __init__(self):
        self.eval_called = False

    def eval(self):
        self.eval_called = True
        return self

    def __call__(self, **kwargs):
        return SimpleNamespace(logits=torch.tensor([[0.0, 2.0]]))


class FactoryDifficultyRouterTests(unittest.TestCase):
    def test_returns_calibrated_probability_of_stronger_lane(self):
        tokenizer = FakeTokenizer()
        model = FakeModel()
        router = FactoryDifficultyRouter(
            model=model,
            tokenizer=tokenizer,
            calibration=lambda score: score * 0.5,
        )

        score = router.calculate_strong_win_rate("change the parser")

        expected_raw = math.exp(2.0) / (math.exp(0.0) + math.exp(2.0))
        self.assertAlmostEqual(score, expected_raw * 0.5, places=6)
        self.assertTrue(model.eval_called)
        self.assertEqual(tokenizer.prompt, "change the parser")
        self.assertTrue(tokenizer.kwargs["truncation"])


if __name__ == "__main__":
    unittest.main()
