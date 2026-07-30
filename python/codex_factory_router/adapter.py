"""One-shot JSON adapter for the Node.js Factory coordinator."""

import argparse
import json
import os
import sys
import time
from pathlib import Path

for _name in ["HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE"]:
    os.environ[_name] = "1"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["TRANSFORMERS_VERBOSITY"] = "error"

MAX_REQUEST_BYTES = 65536


def _deny_network(event, _arguments):
    if event in {"socket.connect", "socket.connect_ex", "socket.getaddrinfo"}:
        raise RuntimeError("Network access is disabled during Factory router inference")


def _read_request(path):
    raw = path.read_bytes()
    if len(raw) > MAX_REQUEST_BYTES:
        raise ValueError(f"Adapter request file exceeds {MAX_REQUEST_BYTES} bytes")
    return json.loads(raw.decode("utf-8"))


def classify(request_path):
    started = time.perf_counter()
    sys.addaudithook(_deny_network)
    from .calibration import load_calibration
    from .factory_router import load_factory_router
    from .fingerprints import checkpoint_fingerprint
    from .schemas import parse_request
    from .thresholds import load_threshold_set

    request = parse_request(_read_request(request_path))
    fingerprint = checkpoint_fingerprint(request.checkpoint)
    thresholds = load_threshold_set(request.checkpoint, request.threshold_set, fingerprint)
    calibration = load_calibration(request.checkpoint)
    router = load_factory_router(request.checkpoint, calibration)
    score = router.calculate_strong_win_rate(request.encoded_task)
    root = Path(__file__).resolve().parents[2]
    revision = (root / "third_party" / "routellm" / "REVISION").read_text(encoding="utf-8").strip()
    return {
        "schemaVersion": 1,
        "taskId": request.task_id,
        "router": request.router,
        "difficultyScore": score,
        "scoreMeaning": "probability_stronger_lane_required",
        "checkpointFingerprint": fingerprint,
        "thresholdSet": request.threshold_set,
        "thresholdFingerprint": thresholds.fingerprint,
        "reviewThreshold": thresholds.review_threshold,
        "criticalEscalationThreshold": thresholds.critical_escalation_threshold,
        "criticalFalseNegatives": thresholds.critical_false_negatives,
        "routeLLMRevision": revision,
        "durationMs": round((time.perf_counter() - started) * 1000),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Score one bounded Codex Factory task")
    parser.add_argument("--request", required=True)
    options = parser.parse_args(argv)
    response = classify(Path(options.request))
    sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        sys.stderr.write(f"Factory router adapter failed: {error}\n")
        raise SystemExit(1)
