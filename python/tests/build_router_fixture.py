import argparse
import hashlib
import json
from pathlib import Path

from test_adapter import create_tiny_checkpoint

from codex_factory_router.fingerprints import checkpoint_fingerprint


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    checkpoint = root / "checkpoint"
    checkpoint.mkdir(parents=True)
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
    print(
        json.dumps(
            {
                "checkpoint": str(checkpoint),
                "checkpointFingerprint": fingerprint,
                "thresholdFingerprint": "sha256:"
                + hashlib.sha256(threshold_path.read_bytes()).hexdigest(),
            }
        )
    )


if __name__ == "__main__":
    main()
