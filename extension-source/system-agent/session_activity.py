"""
FocusGuard AI - Session Activity Calculator (Phase 5)

Calculates total session duration, active time, and idle time for browser
domain sessions by combining domain session windows with system activity events.

PRIVACY & SAFETY:
- No key logs, coordinates, text, or sensitive data are processed.
- Only timestamps and interval durations are used for calculations.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# Default production idle threshold (600 seconds = 10 minutes)
IDLE_THRESHOLD_SECONDS: float = 600.0

# Curated domain registry for Phase 6 classification
DOMAIN_CATEGORIES: Dict[str, str] = {
    "github.com": "educational",
    "stackoverflow.com": "educational",
    "coursera.org": "educational",
    "udemy.com": "educational",
    "instagram.com": "non_educational",
    "netflix.com": "non_educational",
    "youtube.com": "unknown",
}


def classify_domain(domain: Optional[str]) -> str:
    """
    Classify a domain into 'educational', 'non_educational', or 'unknown'
    using the curated registry, domain normalization, and subdomain fallback.
    """
    if not domain or not isinstance(domain, str):
        return "unknown"

    clean_domain = domain.strip().lower()

    # Strip http:// or https:// if present
    if "://" in clean_domain:
        clean_domain = clean_domain.split("://", 1)[1]
    if clean_domain.startswith("www."):
        clean_domain = clean_domain[4:]
    if "/" in clean_domain:
        clean_domain = clean_domain.split("/", 1)[0]
    if ":" in clean_domain:
        clean_domain = clean_domain.split(":", 1)[0]

    # 1. Direct registry lookup
    if clean_domain in DOMAIN_CATEGORIES:
        return DOMAIN_CATEGORIES[clean_domain]

    # 2. Subdomain resolution (e.g. docs.github.com -> github.com)
    parts = clean_domain.split(".")
    for i in range(1, len(parts) - 1):
        parent_domain = ".".join(parts[i:])
        if parent_domain in DOMAIN_CATEGORIES:
            return DOMAIN_CATEGORIES[parent_domain]

    return "unknown"


def format_iso8601(timestamp: float) -> str:
    """Format a Unix epoch timestamp as an ISO-8601 UTC string."""
    dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(dt.microsecond / 1000):03d}Z"


def format_time_hhmm(timestamp: float) -> str:
    """Format a Unix epoch timestamp as local 'HH:MM' string."""
    dt = datetime.fromtimestamp(timestamp)
    return dt.strftime("%H:%M")


def clip_interval_to_range(
    interval_start: float,
    interval_end: float,
    range_start: float,
    range_end: float,
) -> float:
    """
    Calculate the overlap duration (in seconds) between an interval and a range.
    Returns 0.0 if there is no overlap.
    """
    overlap_start = max(interval_start, range_start)
    overlap_end = min(interval_end, range_end)
    return max(0.0, overlap_end - overlap_start)


class SessionActivityCalculator:
    """
    Manages and calculates active and idle durations for domain browsing sessions.
    """

    def __init__(self, idle_threshold_seconds: float = IDLE_THRESHOLD_SECONDS):
        """
        Initialize the session calculator.

        :param idle_threshold_seconds: Inactivity time in seconds before an idle period begins.
                                       Defaults to 600s (10 minutes).
        """
        self.idle_threshold_seconds: float = float(idle_threshold_seconds)

        # Active session state
        self.current_domain: Optional[str] = None
        self.session_start_time: Optional[float] = None
        self.last_activity_time: Optional[float] = None

        # Idle tracking state
        # List of completed idle intervals: [(idle_start, idle_end), ...]
        self.completed_idle_periods: List[Tuple[float, float]] = []
        # Ongoing idle start timestamp (if currently in idle state)
        self.current_idle_start: Optional[float] = None

    def start_session(self, domain: str, start_time: float) -> None:
        """
        Start a new browser session for a specific domain.

        :param domain: Normalized domain name (e.g., 'github.com').
        :param start_time: Epoch timestamp in seconds when the session began.
        """
        self.current_domain = domain
        self.session_start_time = float(start_time)
        self.last_activity_time = float(start_time)
        self.completed_idle_periods = []
        self.current_idle_start = None

    def record_activity(self, event_time: float) -> None:
        """
        Record a user input event (keyboard or mouse).
        If user was idle, closes the current idle period.

        :param event_time: Epoch timestamp in seconds when activity occurred.
        """
        event_time = float(event_time)

        # If user was currently idle, close the idle period at this event time
        if self.current_idle_start is not None:
            idle_end = event_time
            if idle_end > self.current_idle_start:
                self.completed_idle_periods.append((self.current_idle_start, idle_end))
            self.current_idle_start = None

        self.last_activity_time = event_time

    def check_or_record_idle(self, current_time: float) -> None:
        """
        Check elapsed inactivity at current_time. If threshold is reached and
        idle hasn't started yet, mark the beginning of an idle period.

        :param current_time: Epoch timestamp in seconds.
        """
        if self.last_activity_time is None:
            return

        current_time = float(current_time)
        idle_gap = current_time - self.last_activity_time

        if idle_gap >= self.idle_threshold_seconds:
            if self.current_idle_start is None:
                # Idle began exactly at (last_activity_time + threshold)
                self.current_idle_start = self.last_activity_time + self.idle_threshold_seconds

    def compute_durations(
        self,
        start_time: float,
        end_time: float,
        idle_periods: List[Tuple[float, float]],
    ) -> Tuple[int, int, int]:
        """
        Pure calculation function to compute (duration, active_time, idle_time)
        clipped strictly to the session window [start_time, end_time].

        Guarantees:
        - duration >= 0, active_time >= 0, idle_time >= 0
        - active_time + idle_time == duration
        """
        start_time = float(start_time)
        end_time = max(start_time, float(end_time))
        total_duration = end_time - start_time

        total_idle = 0.0
        for i_start, i_end in idle_periods:
            overlap = clip_interval_to_range(i_start, i_end, start_time, end_time)
            total_idle += overlap

        # Clamp total idle between 0 and total_duration
        total_idle = min(total_idle, total_duration)
        total_idle = max(0.0, total_idle)

        total_active = total_duration - total_idle

        # Convert to integer seconds
        int_duration = int(round(total_duration))
        int_idle = int(round(total_idle))
        int_active = int_duration - int_idle  # Guarantees active + idle == duration

        # Ensure non-negative
        if int_active < 0:
            int_active = 0
            int_idle = int_duration

        return int_duration, int_active, int_idle

    def get_live_session_state(self, current_time: float) -> Optional[Dict[str, Any]]:
        """
        Calculate live session duration, active time, and idle time for the ongoing session
        without modifying state or writing to storage.

        :param current_time: Epoch timestamp in seconds.
        :return: Current session state dictionary or None if no active session.
        """
        if self.session_start_time is None or self.current_domain is None:
            return None

        current_time = float(current_time)
        self.check_or_record_idle(current_time)

        # Assemble list of all idle periods including currently active idle
        all_idle = list(self.completed_idle_periods)
        if self.current_idle_start is not None:
            effective_end = min(current_time, current_time)
            if effective_end > self.current_idle_start:
                all_idle.append((self.current_idle_start, effective_end))

        duration, active_time, idle_time = self.compute_durations(
            self.session_start_time, current_time, all_idle
        )

        return {
            "domain": self.current_domain,
            "category": classify_domain(self.current_domain),
            "session_start": format_iso8601(self.session_start_time),
            "current_time": format_iso8601(current_time),
            "duration": duration,
            "active_time": active_time,
            "idle_time": idle_time,
        }

    def end_session(self, end_time: float) -> Optional[Dict[str, Any]]:
        """
        Finalize the current active browsing session at end_time.
        Closes any pending idle period at min(resume_time, session_end),
        calculates final duration, active_time, and idle_time, and resets session state.

        :param end_time: Epoch timestamp in seconds when the session ended.
        :return: Final session summary dictionary or None.
        """
        if self.session_start_time is None or self.current_domain is None:
            return None

        end_time = max(self.session_start_time, float(end_time))
        self.check_or_record_idle(end_time)

        # If currently idle when session ends, cap idle at session_end
        all_idle = list(self.completed_idle_periods)
        if self.current_idle_start is not None:
            capped_idle_end = min(end_time, end_time)
            if capped_idle_end > self.current_idle_start:
                all_idle.append((self.current_idle_start, capped_idle_end))

        duration, active_time, idle_time = self.compute_durations(
            self.session_start_time, end_time, all_idle
        )

        domain = self.current_domain
        start_ts = self.session_start_time

        summary = {
            "domain": domain,
            "category": classify_domain(domain),
            "session_start": format_iso8601(start_ts),
            "session_end": format_iso8601(end_time),
            "duration": duration,
            "active_time": active_time,
            "idle_time": idle_time,
        }

        # Reset active session
        self.current_domain = None
        self.session_start_time = None
        self.last_activity_time = None
        self.completed_idle_periods = []
        self.current_idle_start = None

        return summary

    def to_team2_format(
        self,
        summary: Dict[str, Any],
        source: str = "extension",
    ) -> Dict[str, Any]:
        """
        Converts a session summary into the required Team 2 JSON record format.
        Preserves all 5 original required fields:
        - source
        - name
        - start_time (HH:MM)
        - end_time (HH:MM)
        - duration

        And includes Phase 5 & 6 additions:
        - category
        - active_time
        - idle_time

        :param summary: Summary dictionary returned by end_session.
        :param source: Telemetry source, defaults to 'extension'.
        :return: Team 2 JSON record.
        """
        # Extract ISO strings and convert to HH:MM
        start_dt = datetime.fromisoformat(summary["session_start"].replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(summary["session_end"].replace("Z", "+00:00"))

        return {
            "source": source,
            "name": summary["domain"],
            "category": summary.get("category", classify_domain(summary["domain"])),
            "start_time": f"{start_dt.hour:02d}:{start_dt.minute:02d}",
            "end_time": f"{end_dt.hour:02d}:{end_dt.minute:02d}",
            "duration": summary["duration"],
            "active_time": summary["active_time"],
            "idle_time": summary["idle_time"],
            # Supplementary metadata
            "session_start": summary["session_start"],
            "session_end": summary["session_end"],
        }
