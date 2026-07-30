"""Versioned score calibration for Factory router checkpoints."""

import json
import math
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class IdentityCalibration:
    def apply(self, raw_score: float) -> float:
        return raw_score


@dataclass(frozen=True)
class PlattCalibration:
    slope: float
    intercept: float

    def apply(self, raw_score: float) -> float:
        value = self.slope * raw_score + self.intercept
        return 1.0 / (1.0 + math.exp(-value))


def load_calibration(checkpoint: Path):
    calibration_path = checkpoint / "calibration.json"
    try:
        value = json.loads(calibration_path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError("Factory router checkpoint is missing calibration.json") from error
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("Factory router calibration schemaVersion must be 1")
    calibration_type = value.get("type")
    if calibration_type == "identity":
        return IdentityCalibration()
    if calibration_type == "platt":
        slope = value.get("slope")
        intercept = value.get("intercept")
        if not all(isinstance(item, (int, float)) and math.isfinite(item) for item in [slope, intercept]):
            raise ValueError("Platt calibration requires finite slope and intercept")
        return PlattCalibration(float(slope), float(intercept))
    raise ValueError(f"Unsupported Factory router calibration type: {calibration_type}")
