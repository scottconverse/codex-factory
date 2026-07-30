"""Factory-specific RouteLLM router."""

import math

import torch
from routellm.routers.routers import Router
from transformers import AutoModelForSequenceClassification, AutoTokenizer


class FactoryDifficultyRouter(Router):
    """Interpret a binary classifier as stronger-lane requirement probability."""

    def __init__(self, model, tokenizer, calibration=None):
        self.model = model.eval()
        self.tokenizer = tokenizer
        self.calibration = calibration

    def calculate_strong_win_rate(self, prompt: str) -> float:
        if not isinstance(prompt, str) or not prompt:
            raise ValueError("prompt must be a non-empty string")
        inputs = self.tokenizer(
            prompt,
            return_tensors="pt",
            padding=True,
            truncation=True,
        )
        with torch.no_grad():
            logits = self.model(**inputs).logits
            if tuple(logits.shape) != (1, 2):
                raise ValueError("Factory router checkpoint must emit exactly two logits")
            raw_score = float(torch.softmax(logits, dim=-1)[0, 1].item())
        if self.calibration is None:
            score = raw_score
        elif callable(self.calibration):
            score = float(self.calibration(raw_score))
        else:
            score = float(self.calibration.apply(raw_score))
        if not math.isfinite(score) or not 0.0 <= score <= 1.0:
            raise ValueError("Calibrated Factory router score must be between zero and one")
        return score


def load_factory_router(checkpoint, calibration):
    model = AutoModelForSequenceClassification.from_pretrained(
        checkpoint,
        local_files_only=True,
    )
    if model.config.num_labels != 2:
        raise ValueError("Factory router checkpoint must declare exactly two labels")
    tokenizer = AutoTokenizer.from_pretrained(
        checkpoint,
        local_files_only=True,
    )
    return FactoryDifficultyRouter(model=model, tokenizer=tokenizer, calibration=calibration)
