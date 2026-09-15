"""
FocusGuard AI - Team 1 Common Activity Contract v1 Adapter

Converts a Team 1 Windows desktop agent WindowEvent / WindowInfo snapshot into
the Common Activity Contract v1 JSON payload for submission to the FocusGuard
resolver-server or any other downstream consumer.

DESIGN RULES (read before modifying):
  - This adapter does NOT modify Team 1 source code.
  - It reads from Team 1 data structures (barshan-team1/src/) but never writes.
  - Privacy enforcement is producer-side: raw window_title, full executable_path,
    and PID are never included in the output dict.
  - The output is a plain Python dict compatible with ActivityEventV1 schema.

Privacy boundary:
  NEVER SENT : window_title (raw), executable_path (full), pid, raw_pathname
  ALLOWED    : source="system_agent", name (app name), timestamps, duration,
               category, process_name (basename only), sanitized_title
"""

import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# ---------------------------------------------------------------------------
# Browser process names that Team 1 must SUPPRESS (extension is authoritative
# for browser sessions — no double-counting).
# ---------------------------------------------------------------------------
BROWSER_PROCESS_NAMES = frozenset({
    "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe",
    "opera.exe", "vivaldi.exe", "arc.exe",
})

# ---------------------------------------------------------------------------
# Team 1 -> Common Activity Contract category mapping
#
# Maps Team 1 APP_CATEGORIES keys to the approved Common Activity Contract v1
# taxonomy.  Only exact string keys from config.py are mapped here.
# ---------------------------------------------------------------------------
_TEAM1_TO_CONTRACT_CATEGORY: Dict[str, str] = {
    "Coding & Development":         "Coding & Development",
    "Social Media & Messaging":     "Communication & Messaging",
    "Entertainment & Streaming":    "Entertainment & Streaming",
    "Productivity & Office":        "Productivity & Office",
    "System & Utilities":           "System & Utilities",
    "Learning on YouTube":          "Learning & Research",
    "Uncategorized / Browsing":     "Unknown",
}

# ---------------------------------------------------------------------------
# Title sanitizer
# ---------------------------------------------------------------------------

# Patterns for content that must never appear in sanitized_title
_SANITIZE_PATTERNS = [
    re.compile(r"[A-Za-z]:[/\\\\].{1,200}"),    # Windows file paths
    re.compile(r"[\w.\-]+@[\w.\-]+\.\w+"),        # email addresses
    re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),  # IP addresses
    re.compile(r"[?#&][\w%=&+.]+"),               # URL query fragments
    re.compile(r"\b(password|token|secret|key|auth|bearer)\s*[:=]\s*\S+", re.IGNORECASE),
]


def _sanitize_title(raw_title: str) -> Optional[str]:
    """
    Strip privacy-sensitive content from a raw window title.

    Returns the sanitized string, or None if the title is empty after
    sanitization (which triggers omission from the output payload).
    """
    if not raw_title or not raw_title.strip():
        return None

    cleaned = raw_title.strip()
    for pattern in _SANITIZE_PATTERNS:
        cleaned = pattern.sub("[redacted]", cleaned)

    # Control characters
    cleaned = re.sub(r"[\x00-\x1F\x7F]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = cleaned[:200]  # Hard cap

    return cleaned if cleaned else None


def _safe_process_basename(executable_path: str, process_name: str) -> str:
    """
    Return the basename of the process executable.
    Never returns the full path.
    """
    if process_name:
        return os.path.basename(process_name)
    if executable_path:
        return os.path.basename(executable_path)
    return "unknown.exe"


def _map_category(team1_category: str) -> Optional[str]:
    """Map a Team 1 category string to the contract taxonomy, or None."""
    return _TEAM1_TO_CONTRACT_CATEGORY.get(team1_category)


def _format_iso8601_utc(dt: datetime) -> str:
    """Return YYYY-MM-DDTHH:MM:SSZ for a datetime (UTC)."""
    utc = dt.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Public adapter interface
# ---------------------------------------------------------------------------

def to_common_format(
    process_name: str,
    window_title: str,
    start_time: datetime,
    end_time: datetime,
    duration_seconds: int,
    executable_path: str = "",
    team1_category: str = "",
    pid: Optional[int] = None,          # Accepted for compatibility; NEVER forwarded
) -> Optional[Dict[str, Any]]:
    """
    Convert Team 1 activity data to a Common Activity Contract v1 dict.

    Returns:
        dict  - valid contract payload ready for JSON serialisation.
        None  - if the event must be suppressed (browser process).

    Privacy guarantees:
        - `pid` parameter is accepted but NEVER included in the output.
        - `window_title` is sanitized; raw value is never in the output.
        - `executable_path` is reduced to basename only in `process_name`.
        - Full path is never emitted.
    """
    proc_lower = (process_name or "").lower().strip()

    # Suppress browser events — extension is authoritative
    if proc_lower in BROWSER_PROCESS_NAMES:
        return None

    # Canonical application name: prefer human-readable over raw process name
    app_name = _safe_process_basename(executable_path, process_name)
    # Remove .exe suffix for cleaner display
    display_name = re.sub(r"\.exe$", "", app_name, flags=re.IGNORECASE) if app_name else "Unknown"

    # Timestamps — always UTC ISO-8601
    start_iso = _format_iso8601_utc(start_time)
    end_iso   = _format_iso8601_utc(end_time)

    # Duration — ensure non-negative integer
    duration_int = max(0, int(round(duration_seconds)))

    # Build mandatory fields
    payload: Dict[str, Any] = {
        "source":     "system_agent",
        "name":       display_name,
        "start_time": start_iso,
        "end_time":   end_iso,
        "duration":   duration_int,
    }

    # Optional: category (mapped from Team 1 taxonomy)
    contract_category = _map_category(team1_category) if team1_category else None
    if contract_category:
        payload["category"] = contract_category

    # Optional: process_name (basename only — never full path)
    if app_name and app_name != "unknown.exe":
        payload["process_name"] = app_name

    # Optional: sanitized_title (PII stripped)
    safe_title = _sanitize_title(window_title)
    if safe_title:
        payload["sanitized_title"] = safe_title

    # Privacy assertion: ensure banned fields are absent
    for banned in ("window_title", "executable_path", "pid", "raw_pathname"):
        assert banned not in payload, f"Privacy violation: {banned!r} must not be in payload"

    return payload


def is_browser_process(process_name: str) -> bool:
    """
    Return True if this process name is a known browser.
    Team 1 callers can use this to skip logging before calling to_common_format.
    """
    return (process_name or "").lower().strip() in BROWSER_PROCESS_NAMES
