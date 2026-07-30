"""Strict adapter request schema."""

import re
from dataclasses import dataclass
from pathlib import Path

TASK_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
NAME = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,127}$")
REQUEST_FIELDS = {
    "schemaVersion",
    "taskId",
    "encodedTask",
    "router",
    "checkpoint",
    "thresholdSet",
    "timeoutSeconds",
}


@dataclass(frozen=True)
class AdapterRequest:
    task_id: str
    encoded_task: str
    router: str
    checkpoint: Path
    threshold_set: str
    timeout_seconds: int


def parse_request(value, *, max_input_bytes=32768):
    if not isinstance(value, dict) or set(value) != REQUEST_FIELDS:
        raise ValueError("Adapter request must contain exactly the schemaVersion 1 fields")
    if value["schemaVersion"] != 1:
        raise ValueError("Adapter request schemaVersion must be 1")
    if not isinstance(value["taskId"], str) or not TASK_ID.fullmatch(value["taskId"]):
        raise ValueError("Adapter request taskId is invalid")
    encoded_task = value["encodedTask"]
    if not isinstance(encoded_task, str) or not encoded_task:
        raise ValueError("Adapter request encodedTask must be a non-empty string")
    if len(encoded_task.encode("utf-8")) > max_input_bytes:
        raise ValueError(f"Adapter request encodedTask exceeds {max_input_bytes} bytes")
    if value["router"] != "factory_bert":
        raise ValueError("Adapter request router must be factory_bert")
    checkpoint = value["checkpoint"]
    if not isinstance(checkpoint, str) or not checkpoint or "\x00" in checkpoint:
        raise ValueError("Adapter request checkpoint is invalid")
    threshold_set = value["thresholdSet"]
    if not isinstance(threshold_set, str) or not NAME.fullmatch(threshold_set):
        raise ValueError("Adapter request thresholdSet is invalid")
    timeout_seconds = value["timeoutSeconds"]
    if not isinstance(timeout_seconds, int) or isinstance(timeout_seconds, bool) or not 1 <= timeout_seconds <= 300:
        raise ValueError("Adapter request timeoutSeconds must be between 1 and 300")
    return AdapterRequest(
        task_id=value["taskId"],
        encoded_task=encoded_task,
        router=value["router"],
        checkpoint=Path(checkpoint).resolve(),
        threshold_set=threshold_set,
        timeout_seconds=timeout_seconds,
    )
