"""Stable, privacy-bounded Factory task encoding for training and evaluation."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

ENCODER_VERSION = "1"
_URL = re.compile(r"\b(?:https?|ssh|git)://[^\s<>\"']+", re.IGNORECASE)
_WINDOWS_PATH = re.compile(r"\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*")
_CREDENTIAL = re.compile(
    r"(^|[\s;])((?:api[_-]?key|access[_-]?token|password|secret|credential)\s*[=:]\s*)[^\s;]+",
    re.IGNORECASE | re.MULTILINE,
)


@dataclass(frozen=True)
class EncodedTask:
    text: str
    sha256: str
    bytes: int
    version: str = ENCODER_VERSION


def _redact(value: str) -> str:
    value = _URL.sub("[URL]", value)
    value = _WINDOWS_PATH.sub("[ABSOLUTE_PATH]", value)
    return _CREDENTIAL.sub(lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", value)


def _paths(value, label):
    if not isinstance(value, list) or len(value) > 256:
        raise ValueError(f"{label} must be a bounded array")
    normalized = []
    for entry in value:
        if (
            not isinstance(entry, str)
            or not entry
            or "\x00" in entry
            or re.match(r"^[A-Za-z]:[\\/]", entry)
            or entry.startswith(("/", "\\\\"))
        ):
            raise ValueError(f"{label} must be a relative repository path")
        candidate = entry.replace("\\", "/")
        if any(part in {"", ".", ".."} for part in candidate.split("/")):
            raise ValueError(f"{label} must be a relative repository path without traversal")
        normalized.append(candidate)
    return sorted(set(normalized))


def _strings(value, label):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 256 or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{label} must be a bounded string array")
    return value


def encode_task(value, *, max_input_bytes=32_768):
    if not isinstance(value, dict):
        raise ValueError("Factory task must be an object")
    if value.get("accessFamily") not in {"read", "write"}:
        raise ValueError("Factory task accessFamily must be read or write")
    if value.get("taskType") not in {"inventory", "mechanical", "review", "implementation"}:
        raise ValueError("Factory task taskType is invalid")
    instructions = value.get("instructions")
    if not isinstance(instructions, str) or len(instructions.strip()) < 10:
        raise ValueError("Factory task instructions are incomplete")
    read_paths = _paths(value.get("readPaths", []), "Factory task read path")
    write_paths = _paths(value.get("writePaths", []), "Factory task write path")
    if value["accessFamily"] == "read" and write_paths:
        raise ValueError("Read task cannot declare write paths")
    if value["accessFamily"] == "write" and not write_paths:
        raise ValueError("Write task requires a write path")
    dependencies = value.get("dependencies", 0)
    if isinstance(dependencies, bool) or not isinstance(dependencies, int) or dependencies < 0:
        raise ValueError("Factory task dependencies must be a nonnegative integer")
    parallel_safe = value.get("parallelSafe", False)
    if not isinstance(parallel_safe, bool):
        raise ValueError("Factory task parallelSafe must be boolean")

    lines = [
        "[FACTORY_TASK_V1]",
        f"encoder_version: {ENCODER_VERSION}",
        f"operation: {value['accessFamily']}",
        f"task_type: {value['taskType']}",
        "instructions:",
        _redact(instructions.replace("\r\n", "\n").replace("\r", "\n").strip()),
        "acceptance:",
        *[f"- {_redact(item.replace(chr(13) + chr(10), chr(10)).replace(chr(13), chr(10)))}" for item in _strings(value.get("acceptance"), "Factory task acceptance")],
        "read_paths:",
        *[f"- {item}" for item in read_paths],
        "write_paths:",
        *[f"- {item}" for item in write_paths],
        "checks:",
        *[f"- {_redact(item.replace(chr(13) + chr(10), chr(10)).replace(chr(13), chr(10)))}" for item in _strings(value.get("checks"), "Factory task checks")],
        f"dependencies: {dependencies}",
        f"parallel_safe: {str(parallel_safe).lower()}",
    ]
    text = "\n".join(lines) + "\n"
    encoded = text.encode("utf-8")
    if len(encoded) > max_input_bytes:
        raise ValueError(f"Factory encoded task exceeds {max_input_bytes} bytes")
    return EncodedTask(
        text=text,
        sha256="sha256:" + hashlib.sha256(encoded).hexdigest(),
        bytes=len(encoded),
    )
