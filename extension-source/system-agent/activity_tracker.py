"""
FocusGuard AI - System-Level Activity Tracker (Phase 4)

Monitors mouse and keyboard activity to detect user presence (Active vs. Idle)
using Python and pynput.

PRIVACY & SAFETY GUARANTEES:
- Zero keystrokes, typed text, or passwords captured or stored.
- Zero mouse coordinates (X, Y) captured or stored.
- Zero screenshots, window titles, or clipboard data captured.
- Only input timestamps and computed active/idle status are maintained.
"""

import argparse
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

try:
    from pynput import keyboard, mouse
    PYNPUT_AVAILABLE = True
except ImportError:
    PYNPUT_AVAILABLE = False


# Default threshold in seconds (600 seconds = 10 minutes)
IDLE_THRESHOLD_SECONDS: float = 600.0


def format_iso8601(timestamp: float) -> str:
    """Format a Unix epoch timestamp as an ISO-8601 UTC string."""
    dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(dt.microsecond / 1000):03d}Z"


class ActivityTracker:
    """
    Privacy-first system-level activity tracker.

    Tracks whether the user is actively interacting with the computer or idle
    based on mouse and keyboard events.
    """

    def __init__(
        self,
        idle_threshold_seconds: float = IDLE_THRESHOLD_SECONDS,
        time_func: Callable[[], float] = time.time,
        on_state_change: Optional[Callable[[Dict[str, Any]], None]] = None,
    ):
        """
        Initialize the activity tracker.

        :param idle_threshold_seconds: Inactivity time (in seconds) before marking user as IDLE.
                                       Defaults to 600 (10 minutes).
        :param time_func: Callable returning current epoch time in seconds (injectable for testing).
        :param on_state_change: Optional callback function triggered on state transition.
        """
        self.idle_threshold_seconds: float = float(idle_threshold_seconds)
        self._time_func: Callable[[], float] = time_func
        self._on_state_change: Optional[Callable[[Dict[str, Any]], None]] = on_state_change

        self._lock = threading.Lock()
        self._running = False

        # State fields
        now = self._time_func()
        self.last_activity_time: float = now
        self.status: str = "active"  # "active" or "idle"
        self.idle_started_at_timestamp: Optional[float] = None
        self.idle_duration: float = 0.0

        # Listener threads
        self._mouse_listener: Optional[Any] = None
        self._keyboard_listener: Optional[Any] = None

    # -------------------------------------------------------------------------
    # Activity Registration (Privacy-Safe Callbacks)
    # -------------------------------------------------------------------------

    def record_activity(self) -> None:
        """
        Record that a user interaction occurred.
        Updates the last activity timestamp. Does NOT store any event details.
        """
        now = self._time_func()
        state_changed = False
        new_state: Dict[str, Any] = {}

        with self._lock:
            self.last_activity_time = now

            # If we were idle and user resumed activity, transition to active
            if self.status == "idle":
                self.status = "active"
                self.idle_started_at_timestamp = None
                self.idle_duration = 0.0
                state_changed = True
                new_state = self._build_state_dict(now)

        if state_changed and self._on_state_change:
            self._on_state_change(new_state)

    def on_mouse_move(self, *args: Any) -> None:
        """
        Callback for mouse move events.
        Intentionally discards coordinates (x, y) to preserve privacy.
        """
        self.record_activity()

    def on_mouse_click(self, *args: Any) -> None:
        """
        Callback for mouse click events.
        Intentionally discards coordinates, button, and press status.
        """
        self.record_activity()

    def on_mouse_scroll(self, *args: Any) -> None:
        """
        Callback for mouse scroll events.
        Intentionally discards coordinates and scroll deltas.
        """
        self.record_activity()

    def on_key_press(self, *args: Any) -> None:
        """
        Callback for keyboard key press events.
        Intentionally discards the key identity/character to preserve privacy.
        """
        self.record_activity()

    def on_key_release(self, *args: Any) -> None:
        """
        Callback for keyboard key release events.
        Intentionally discards the key identity/character to preserve privacy.
        """
        self.record_activity()

    # -------------------------------------------------------------------------
    # State Evaluation & Querying
    # -------------------------------------------------------------------------

    def update_and_get_state(self, current_time: Optional[float] = None) -> Dict[str, Any]:
        """
        Evaluate current elapsed inactivity time, update status, and return state.

        :param current_time: Optional override for current epoch time (useful in tests).
        :return: State dictionary containing status, last_activity, idle_started_at, idle_duration.
        """
        now = current_time if current_time is not None else self._time_func()
        state_changed = False
        state_snapshot: Dict[str, Any] = {}

        with self._lock:
            idle_seconds = max(0.0, now - self.last_activity_time)

            if idle_seconds >= self.idle_threshold_seconds:
                if self.status != "idle":
                    self.status = "idle"
                    # Idle began exactly at (last_activity_time + threshold)
                    self.idle_started_at_timestamp = self.last_activity_time + self.idle_threshold_seconds
                    state_changed = True

                self.idle_duration = idle_seconds
            else:
                if self.status != "active":
                    self.status = "active"
                    self.idle_started_at_timestamp = None
                    state_changed = True

                self.idle_duration = 0.0

            state_snapshot = self._build_state_dict(now)

        if state_changed and self._on_state_change:
            self._on_state_change(state_snapshot)

        return state_snapshot

    def get_state(self) -> Dict[str, Any]:
        """Return the current activity state evaluated at current time."""
        return self.update_and_get_state()

    def _build_state_dict(self, now: float) -> Dict[str, Any]:
        """Internal helper to format the current state into standard dictionary."""
        idle_started_iso = (
            format_iso8601(self.idle_started_at_timestamp)
            if self.idle_started_at_timestamp is not None
            else None
        )

        return {
            "status": self.status,
            "last_activity": format_iso8601(self.last_activity_time),
            "idle_started_at": idle_started_iso,
            "idle_duration": round(self.idle_duration, 2),
        }

    # -------------------------------------------------------------------------
    # Lifecycle Management
    # -------------------------------------------------------------------------

    def start_listeners(self) -> None:
        """Start non-blocking pynput listeners for mouse and keyboard."""
        if not PYNPUT_AVAILABLE:
            raise RuntimeError(
                "The 'pynput' package is not installed. Please run: pip install -r requirements.txt"
            )

        with self._lock:
            if self._running:
                return
            self._running = True

            self._mouse_listener = mouse.Listener(
                on_move=self.on_mouse_move,
                on_click=self.on_mouse_click,
                on_scroll=self.on_mouse_scroll,
            )
            self._keyboard_listener = keyboard.Listener(
                on_press=self.on_key_press,
                on_release=self.on_key_release,
            )

            self._mouse_listener.daemon = True
            self._keyboard_listener.daemon = True

            self._mouse_listener.start()
            self._keyboard_listener.start()

    def stop_listeners(self) -> None:
        """Stop active listeners."""
        with self._lock:
            self._running = False
            if self._mouse_listener is not None:
                self._mouse_listener.stop()
                self._mouse_listener = None
            if self._keyboard_listener is not None:
                self._keyboard_listener.stop()
                self._keyboard_listener = None


# -----------------------------------------------------------------------------
# Standalone CLI Runner
# -----------------------------------------------------------------------------

def run_tracker_cli(
    threshold: float = IDLE_THRESHOLD_SECONDS,
    interval: float = 1.0,
) -> None:
    """Run the tracker in console mode with periodic state logging."""
    def on_change(state: Dict[str, Any]) -> None:
        print(f"\n[TRANSITION] Status changed to -> {state['status'].upper()}")
        print(f"             Details: {state}")

    tracker = ActivityTracker(
        idle_threshold_seconds=threshold,
        on_state_change=on_change,
    )

    print("=" * 60)
    print("FocusGuard AI - System-Level Activity Tracker (Phase 4)")
    print(f"Idle Threshold: {threshold}s ({threshold / 60:.1f} minutes)")
    print(f"Sampling Interval: {interval}s")
    print("Privacy: Zero keys, coordinates, or typed text logged.")
    print("Press Ctrl+C to exit.")
    print("=" * 60)

    try:
        tracker.start_listeners()
    except Exception as e:
        print(f"Error starting activity listeners: {e}")
        sys.exit(1)

    try:
        while True:
            state = tracker.update_and_get_state()
            status_tag = f"[{state['status'].upper()}]"
            idle_info = f"idle_duration={state['idle_duration']}s" if state['status'] == 'idle' else "idle_duration=0s"
            print(
                f"\r{status_tag:<8} Last Activity: {state['last_activity']} | {idle_info}   ",
                end="",
                flush=True,
            )
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\n\nStopping activity tracker...")
    finally:
        tracker.stop_listeners()
        print("Activity tracker stopped.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FocusGuard AI System Activity Tracker")
    parser.add_argument(
        "--threshold",
        type=float,
        default=IDLE_THRESHOLD_SECONDS,
        help=f"Inactivity threshold in seconds (default: {IDLE_THRESHOLD_SECONDS}s)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="Polling / refresh interval in seconds (default: 1.0s)",
    )
    args = parser.parse_args()
    run_tracker_cli(threshold=args.threshold, interval=args.interval)
