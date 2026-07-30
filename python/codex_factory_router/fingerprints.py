"""Stable local artifact fingerprints."""

import hashlib
from pathlib import Path


def checkpoint_fingerprint(checkpoint: Path) -> str:
    if not checkpoint.is_dir():
        raise ValueError("Factory router checkpoint must be a local directory")
    digest = hashlib.sha256()
    files = sorted(
        path
        for path in checkpoint.rglob("*")
        if path.is_file() and path.relative_to(checkpoint).parts[0] != "thresholds"
    )
    if not files:
        raise ValueError("Factory router checkpoint is empty")
    for filename in files:
        if filename.is_symlink():
            raise ValueError("Factory router checkpoint must not contain symbolic links")
        relative = filename.relative_to(checkpoint).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        with filename.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"
