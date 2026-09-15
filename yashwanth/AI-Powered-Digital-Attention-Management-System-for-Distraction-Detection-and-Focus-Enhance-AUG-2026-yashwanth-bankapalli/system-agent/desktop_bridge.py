"""
FocusGuard AI - Desktop Integration Bridge (Step 8: Team 1 + Team 2)

An adapter that bridges Team 1's native Windows application tracking routines
(from barshan-team1/src/) with Team 2's Common Activity Contract v1.

ARCHITECTURE & DESIGN RULES:
1. Adapter, not replacement: Does NOT duplicate Team 1's tracking loop or Common
   Activity Contract's sanitization/taxonomy mapping.
2. Team 2 owns browser activity: Suppresses all browser processes (chrome.exe,
   msedge.exe, firefox.exe, brave.exe, opera.exe, vivaldi.exe, arc.exe).
3. Team 1 owns native applications: Full tracking for non-browser Windows apps.
4. Privacy boundary: Banned fields (pid, raw window_title, executable_path,
   file paths, secrets) are strictly excluded from generated payloads.
5. Idle semantics: Idle inactivity is deducted or suppressed so it never
   artificially inflates active working duration.
6. Read-only to Team 1: Never modifies or deletes any file in barshan-team1/.
"""

import json
import logging
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Union

# Set up logger
logger = logging.getLogger("DesktopBridge")

# Paths configuration
CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parent
TEAM1_ROOT = REPO_ROOT / "barshan-team1"
RESOLVER_ROOT = REPO_ROOT / "resolver-server"

# Ensure local directories are importable
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

if str(TEAM1_ROOT) not in sys.path and TEAM1_ROOT.exists():
    sys.path.insert(0, str(TEAM1_ROOT))

if str(RESOLVER_ROOT) not in sys.path and RESOLVER_ROOT.exists():
    sys.path.insert(0, str(RESOLVER_ROOT))

# Import Common Activity Contract v1 Adapter
try:
    from common_activity_contract import (
        BROWSER_PROCESS_NAMES,
        is_browser_process,
        to_common_format,
    )
except ImportError:
    from system_agent.common_activity_contract import (
        BROWSER_PROCESS_NAMES,
        is_browser_process,
        to_common_format,
    )

# Import ActivityEventV1 for schema validation
try:
    from contracts.activity_event import ActivityCategory, ActivityEventV1
except ImportError:
    ActivityCategory = None
    ActivityEventV1 = None

# Import Team 1 tracker and classifier components (read-only reference)
try:
    from src.classifier.app_classifier import ClassificationResult, classify_app
    from src.config import IDLE_THRESHOLD_SECONDS
    from src.tracker.idle_detector import is_user_idle
    from src.tracker.window_tracker import WindowInfo, get_active_window_info

    TEAM1_AVAILABLE = True
except ImportError:
    TEAM1_AVAILABLE = False
    WindowInfo = None
    get_active_window_info = None
    is_user_idle = None
    classify_app = None
    ClassificationResult = None
    IDLE_THRESHOLD_SECONDS = 600.0


def parse_timestamp(ts: Union[datetime, str, float, int]) -> datetime:
    """
    Parse a timestamp into a UTC-aware datetime object.
    Supports:
    - datetime instances (naive assumed UTC-consistent)
    - float/int Unix epoch timestamps
    - Team 1 string format: '%Y-%m-%d %H:%M:%S'
    - ISO-8601 string format
    """
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            return ts.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc)

    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(float(ts), tz=timezone.utc)

    if isinstance(ts, str):
        cleaned = ts.strip()
        # Try ISO 8601 format
        try:
            dt = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except ValueError:
            pass

        # Try Team 1 datetime format
        try:
            dt = datetime.strptime(cleaned, "%Y-%m-%d %H:%M:%S")
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    raise ValueError(f"Cannot parse timestamp: {ts!r}. Expected datetime, epoch float, or formatted string.")


class DesktopActivityBridge:
    """
    Adapter between Team 1 Windows tracking routines and the Common Activity Contract v1.
    """

    def __init__(
        self,
        idle_threshold_seconds: float = IDLE_THRESHOLD_SECONDS,
        resolver_url: str = "http://127.0.0.1:8000/validate-activity-event",
        get_window_fn: Optional[Callable[[], Optional[Any]]] = None,
        idle_fn: Optional[Callable[..., Any]] = None,
        classifier_fn: Optional[Callable[..., Any]] = None,
    ):
        self.idle_threshold_seconds = float(idle_threshold_seconds)
        self.resolver_url = resolver_url
        self._get_window_fn = get_window_fn or get_active_window_info
        self._idle_fn = idle_fn or is_user_idle
        self._classifier_fn = classifier_fn or classify_app

    def poll_window(self) -> Optional[Any]:
        """Poll the current active foreground window using the configured window function."""
        if not self._get_window_fn:
            return None
        return self._get_window_fn()

    def check_idle(self) -> tuple[bool, float, str]:
        """Check current system idle status using the configured idle function."""
        if not self._idle_fn:
            return False, 0.0, "Working"
        return self._idle_fn(threshold_seconds=self.idle_threshold_seconds)

    def process_window_event(
        self,
        process_name: str,
        window_title: str,
        start_time: Union[datetime, str, float, int],
        end_time: Union[datetime, str, float, int],
        duration_seconds: float,
        executable_path: str = "",
        category: Optional[str] = None,
        pid: Optional[int] = None,
        is_idle: bool = False,
        idle_duration_seconds: float = 0.0,
        drop_idle: bool = True,
    ) -> Optional[Dict[str, Any]]:
        """
        Convert a native window event into a Common Activity Contract v1 payload.

        Returns:
            dict: Valid contract payload compliant with ActivityEventV1.
            None: If the process is a suppressed browser or the event is entirely idle.
        """
        proc_lower = (process_name or "").strip().lower()

        # 1. Suppress browser processes immediately (Team 2 browser authority)
        if is_browser_process(proc_lower):
            logger.debug(f"Suppressed browser process: {process_name}")
            return None

        # 2. Handle idle semantics
        effective_duration = float(duration_seconds)
        if is_idle:
            if idle_duration_seconds > 0.0:
                effective_duration = max(0.0, effective_duration - idle_duration_seconds)
            else:
                effective_duration = 0.0
        elif idle_duration_seconds > 0.0:
            effective_duration = max(0.0, effective_duration - idle_duration_seconds)

        # Drop purely idle events if drop_idle is active
        if drop_idle and effective_duration <= 0.0:
            logger.debug(f"Suppressed idle window event for: {process_name}")
            return None

        # 3. Resolve category via Team 1 classifier if not provided
        resolved_category = category
        if resolved_category is None and self._classifier_fn is not None:
            try:
                # Fast heuristic classification without external LLM call
                res = self._classifier_fn(process_name, window_title, use_llm=False)
                if hasattr(res, "category"):
                    resolved_category = res.category
                elif isinstance(res, dict):
                    resolved_category = res.get("category")
            except Exception as e:
                logger.warning(f"Error during app classification: {e}")
                resolved_category = ""

        # 4. Standardize timestamps
        start_dt = parse_timestamp(start_time)
        end_dt = parse_timestamp(end_time)

        # 5. Delegate to Common Activity Contract adapter
        int_duration = max(0, int(round(effective_duration)))
        payload = to_common_format(
            process_name=process_name,
            window_title=window_title,
            start_time=start_dt,
            end_time=end_dt,
            duration_seconds=int_duration,
            executable_path=executable_path,
            team1_category=resolved_category or "",
            pid=pid,
        )

        return payload

    def adapt_team1_event(
        self,
        event: Any,
        drop_idle: bool = True,
    ) -> Optional[Dict[str, Any]]:
        """
        Adapt a Team 1 WindowEvent dataclass or dict into a contract payload.
        """
        if isinstance(event, dict):
            return self.process_window_event(
                process_name=event.get("process_name", ""),
                window_title=event.get("window_title", ""),
                start_time=event.get("start_time", 0.0),
                end_time=event.get("end_time", 0.0),
                duration_seconds=float(event.get("duration_seconds", 0.0)),
                executable_path=event.get("executable_path", ""),
                category=event.get("category"),
                pid=event.get("pid"),
                is_idle=bool(event.get("is_idle", False)),
                idle_duration_seconds=float(event.get("idle_duration_seconds", 0.0)),
                drop_idle=drop_idle,
            )

        # Dataclass or object instance
        return self.process_window_event(
            process_name=getattr(event, "process_name", ""),
            window_title=getattr(event, "window_title", ""),
            start_time=getattr(event, "start_time", 0.0),
            end_time=getattr(event, "end_time", 0.0),
            duration_seconds=float(getattr(event, "duration_seconds", 0.0)),
            executable_path=getattr(event, "executable_path", ""),
            category=getattr(event, "category", None),
            pid=getattr(event, "pid", None),
            is_idle=bool(getattr(event, "is_idle", False)),
            idle_duration_seconds=float(getattr(event, "idle_duration_seconds", 0.0)),
            drop_idle=drop_idle,
        )

    def validate_event(self, payload: Dict[str, Any]) -> Any:
        """
        Validate the payload against ActivityEventV1 in-process.
        Raises ValueError or ValidationError if invalid.
        """
        if ActivityEventV1 is None:
            raise RuntimeError("ActivityEventV1 schema is not available for in-process validation.")
        return ActivityEventV1(**payload)

    def post_to_resolver(
        self,
        payload: Dict[str, Any],
        endpoint_url: Optional[str] = None,
        timeout: float = 3.0,
    ) -> Dict[str, Any]:
        """
        Post the activity event payload to the resolver server endpoint.
        Returns the parsed response dictionary.
        """
        url = endpoint_url or self.resolver_url
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data_bytes,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status_code = resp.getcode()
            response_body = resp.read().decode("utf-8")
            result = json.loads(response_body)
            result["status_code"] = status_code
            return result
