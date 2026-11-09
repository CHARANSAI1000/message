import base64
import binascii
import re
from typing import Annotated

from pydantic import BeforeValidator, PlainSerializer

USERNAME_RE = re.compile(r"[a-z0-9_.-]{3,32}")
EMAIL_RE = re.compile(r"[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s.]{2,63}")


def normalize_email(value: str) -> str:
    normalized = value.strip().lower()
    if len(normalized) > 254 or not EMAIL_RE.fullmatch(normalized):
        raise ValueError("Enter a valid email address")
    return normalized


def normalize_username(value: str) -> str:
    normalized = value.strip().lower()
    if not USERNAME_RE.fullmatch(normalized):
        raise ValueError("Use 3–32 letters, numbers, dots, underscores, or hyphens")
    return normalized


def _b64decode(value: object) -> bytes:
    if isinstance(value, bytes):
        return value
    if not isinstance(value, str):
        raise ValueError("Expected base64 string")
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64") from exc


# bytes in Python, standard base64 string in JSON
B64Bytes = Annotated[
    bytes,
    BeforeValidator(_b64decode),
    PlainSerializer(lambda b: base64.b64encode(b).decode(), return_type=str),
]
