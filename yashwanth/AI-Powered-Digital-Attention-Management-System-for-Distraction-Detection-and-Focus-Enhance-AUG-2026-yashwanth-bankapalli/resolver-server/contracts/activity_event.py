import re
import uuid as _uuid_module
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict

class ActivitySource(str, Enum):
    EXTENSION    = "extension"
    SYSTEM_AGENT = "system_agent"

class ActivityCategory(str, Enum):
    CODING        = "Coding & Development"
    LEARNING      = "Learning & Research"
    PRODUCTIVITY  = "Productivity & Office"
    COMMUNICATION = "Communication & Messaging"
    SOCIAL_MEDIA  = "Social Media"
    ENTERTAINMENT = "Entertainment & Streaming"
    GAMING        = "Gaming"
    SYSTEM        = "System & Utilities"
    OTHER         = "Other"
    UNKNOWN       = "Unknown"

_ISO8601_UTC_RE = re.compile(
    r"^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])"
    r"T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$"
)
_HHMM_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")

def _is_valid_timestamp(value: str) -> bool:
    return bool(_ISO8601_UTC_RE.match(value) or _HHMM_RE.match(value))

class ActivityEventV1(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, populate_by_name=True)
    source: ActivitySource = Field(...)
    name: str = Field(..., min_length=1)
    start_time: str = Field(...)
    end_time: str = Field(...)
    duration: int = Field(..., ge=0)
    category: Optional[ActivityCategory] = Field(default=None)
    process_name: Optional[str] = Field(default=None)
    sanitized_title: Optional[str] = Field(default=None)
    sanitized_pathname: Optional[str] = Field(default=None)
    event_id: Optional[str] = Field(default=None)

    @field_validator("start_time", "end_time")
    @classmethod
    def validate_timestamp(cls, v: str) -> str:
        if not _is_valid_timestamp(v):
            raise ValueError(f"Timestamp {v!r} is invalid.")
        return v

    @field_validator("event_id")
    @classmethod
    def validate_event_id(cls, v):
        if v is None:
            return None
        try:
            _uuid_module.UUID(v)
        except (ValueError, AttributeError):
            raise ValueError(f"event_id {v!r} is not a valid UUID.")
        return v

    @field_validator("process_name")
    @classmethod
    def validate_process_name(cls, v):
        if v is None:
            return None
        s = v.strip()
        if "\\" in s or (s.count("/") > 1):
            raise ValueError(f"process_name must be a basename, not a full path: {v!r}")
        return s

    @field_validator("sanitized_pathname")
    @classmethod
    def validate_sanitized_pathname(cls, v):
        if v is None:
            return None
        c = v.strip()
        if "?" in c or "#" in c:
            raise ValueError(f"sanitized_pathname must not contain query params or fragments: {v!r}")
        return c

    @model_validator(mode="after")
    def validate_name_content(self) -> "ActivityEventV1":
        n = self.name
        if "://" in n:
            raise ValueError(f"name must not be a full URL: {n!r}")
        if n.startswith("/") or (len(n) > 2 and n[1] == ":"):
            raise ValueError(f"name must not be a filesystem path: {n!r}")
        return self
