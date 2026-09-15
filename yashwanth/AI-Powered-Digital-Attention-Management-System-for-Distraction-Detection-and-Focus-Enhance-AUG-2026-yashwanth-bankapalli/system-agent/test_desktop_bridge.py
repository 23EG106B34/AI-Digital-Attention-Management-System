"""
FocusGuard AI - Desktop Integration Bridge Test Suite (Step 8)

Tests for system-agent/desktop_bridge.py verifying:
1. Native application (e.g. code.exe) produces a valid event.
2. Chrome is suppressed.
3. Edge is suppressed.
4. Firefox is suppressed.
5. Other native applications remain tracked.
6. Team 1 timestamps ('%Y-%m-%d %H:%M:%S') are converted correctly to ISO-8601 UTC.
7. Float duration becomes valid integer duration.
8. Category mapping remains valid.
9. Sanitized title contains no sensitive raw data (paths, emails, IPs, secrets).
10. Generated event contains no pid.
11. Generated event contains no raw window_title.
12. Generated event contains no raw executable_path.
13. Generated event validates against ActivityEventV1 schema.
14. Idle activity does not incorrectly become active duration.
"""

from datetime import datetime, timezone
import pytest
import sys
from pathlib import Path

# Set up paths
SYSTEM_AGENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SYSTEM_AGENT_DIR.parent
RESOLVER_ROOT = REPO_ROOT / "resolver-server"

if str(SYSTEM_AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(SYSTEM_AGENT_DIR))
if str(RESOLVER_ROOT) not in sys.path:
    sys.path.insert(0, str(RESOLVER_ROOT))

from desktop_bridge import DesktopActivityBridge, parse_timestamp
from contracts.activity_event import ActivityCategory, ActivityEventV1


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def bridge():
    """Create a standard bridge instance with mockable callbacks."""
    return DesktopActivityBridge()


# ---------------------------------------------------------------------------
# Test Cases
# ---------------------------------------------------------------------------

def test_01_native_application_produces_valid_event(bridge):
    """1. Native application such as code.exe produces a valid event."""
    event = bridge.process_window_event(
        process_name="code.exe",
        window_title="main.py - FocusGuard - Visual Studio Code",
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:05:00",
        duration_seconds=300.0,
        executable_path="C:\\Users\\LOQ\\AppData\\Local\\Programs\\Microsoft VS Code\\code.exe",
        category="Coding & Development",
    )

    assert event is not None
    assert event["source"] == "system_agent"
    assert event["name"] == "code"
    assert event["process_name"] == "code.exe"
    assert event["duration"] == 300
    assert event["category"] == "Coding & Development"
    assert "start_time" in event
    assert "end_time" in event


def test_02_chrome_is_suppressed(bridge):
    """2. Chrome is suppressed (Team 2 browser ownership)."""
    event = bridge.process_window_event(
        process_name="chrome.exe",
        window_title="GitHub - Repository - Google Chrome",
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:05:00",
        duration_seconds=300.0,
    )
    assert event is None


def test_03_edge_is_suppressed(bridge):
    """3. Edge is suppressed (Team 2 browser ownership)."""
    event = bridge.process_window_event(
        process_name="msedge.exe",
        window_title="Microsoft Edge",
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:05:00",
        duration_seconds=300.0,
    )
    assert event is None


def test_04_firefox_is_suppressed(bridge):
    """4. Firefox is suppressed (Team 2 browser ownership)."""
    event = bridge.process_window_event(
        process_name="firefox.exe",
        window_title="Mozilla Firefox",
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:05:00",
        duration_seconds=300.0,
    )
    assert event is None


def test_05_native_application_remains_tracked(bridge):
    """5. Native applications other than code.exe remain tracked."""
    apps_to_test = [
        ("pycharm64.exe", "PyCharm - project", "Coding & Development"),
        ("winword.exe", "Document1 - Microsoft Word", "Productivity & Office"),
        ("spotify.exe", "Spotify Free", "Entertainment & Streaming"),
        ("cmd.exe", "Command Prompt", "System & Utilities"),
    ]

    for proc, title, cat in apps_to_test:
        event = bridge.process_window_event(
            process_name=proc,
            window_title=title,
            start_time="2026-09-06 10:00:00",
            end_time="2026-09-06 10:02:00",
            duration_seconds=120.0,
            category=cat,
        )
        assert event is not None, f"Expected {proc} to be tracked"
        assert event["source"] == "system_agent"
        assert event["duration"] == 120
        # Validates against ActivityEventV1
        model = ActivityEventV1(**event)
        assert model.name == proc.replace(".exe", "")


def test_06_team1_timestamp_converted_correctly(bridge):
    """6. Team 1 timestamp ('%Y-%m-%d %H:%M:%S') is converted to UTC ISO-8601."""
    event = bridge.process_window_event(
        process_name="notepad.exe",
        window_title="notes.txt",
        start_time="2026-09-06 12:30:00",
        end_time="2026-09-06 12:35:00",
        duration_seconds=300.0,
    )
    assert event is not None
    assert event["start_time"] == "2026-09-06T12:30:00Z"
    assert event["end_time"] == "2026-09-06T12:35:00Z"


def test_07_float_duration_becomes_valid_integer(bridge):
    """7. Float duration becomes valid integer duration."""
    event = bridge.process_window_event(
        process_name="notepad.exe",
        window_title="notes.txt",
        start_time="2026-09-06 12:00:00",
        end_time="2026-09-06 12:01:00",
        duration_seconds=45.67,
    )
    assert event is not None
    assert isinstance(event["duration"], int)
    assert event["duration"] == 46


def test_08_category_mapping_remains_valid(bridge):
    """8. Team 1 category mapping remains valid under ActivityCategory taxonomy."""
    # Test Social Media & Messaging -> Communication & Messaging
    event = bridge.process_window_event(
        process_name="slack.exe",
        window_title="Slack | General",
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:05:00",
        duration_seconds=300.0,
        category="Social Media & Messaging",
    )
    assert event is not None
    assert event["category"] == "Communication & Messaging"
    assert event["category"] in [c.value for c in ActivityCategory]

    # Test Learning on YouTube -> Learning & Research
    event_yt = bridge.process_window_event(
        process_name="vlc.exe",
        window_title="Tutorial Lecture.mp4",
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:05:00",
        duration_seconds=300.0,
        category="Learning on YouTube",
    )
    assert event_yt is not None
    assert event_yt["category"] == "Learning & Research"


def test_09_sanitized_title_contains_no_sensitive_raw_data(bridge):
    """9. Sanitized title contains no file paths, emails, IPs, or secrets."""
    dirty_title = (
        "C:\\Users\\LOQ\\SecretDocs\\budget.xlsx - "
        "user@example.com - 192.168.1.100 - "
        "token=secret_token_123 - Excel"
    )
    event = bridge.process_window_event(
        process_name="excel.exe",
        window_title=dirty_title,
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:05:00",
        duration_seconds=300.0,
    )
    assert event is not None
    sanitized = event.get("sanitized_title", "")
    assert "C:\\Users" not in sanitized
    assert "user@example.com" not in sanitized
    assert "192.168.1.100" not in sanitized
    assert "secret_token_123" not in sanitized
    assert "[redacted]" in sanitized


def test_10_generated_event_contains_no_pid(bridge):
    """10. Generated event contains no PID."""
    event = bridge.process_window_event(
        process_name="code.exe",
        window_title="main.py",
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:05:00",
        duration_seconds=300.0,
        pid=12345,
    )
    assert event is not None
    assert "pid" not in event


def test_11_generated_event_contains_no_raw_window_title(bridge):
    """11. Generated event contains no raw window_title field."""
    event = bridge.process_window_event(
        process_name="code.exe",
        window_title="main.py - Visual Studio Code",
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:05:00",
        duration_seconds=300.0,
    )
    assert event is not None
    assert "window_title" not in event
    assert "sanitized_title" in event


def test_12_generated_event_contains_no_executable_path(bridge):
    """12. Generated event contains no raw executable_path field."""
    event = bridge.process_window_event(
        process_name="code.exe",
        window_title="main.py",
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:05:00",
        duration_seconds=300.0,
        executable_path="C:\\Program Files\\Microsoft VS Code\\code.exe",
    )
    assert event is not None
    assert "executable_path" not in event
    assert event["process_name"] == "code.exe"


def test_13_generated_event_validates_against_activity_event_v1(bridge):
    """13. Generated event validates directly against ActivityEventV1 schema."""
    event = bridge.process_window_event(
        process_name="pycharm64.exe",
        window_title="FocusGuard - pycharm",
        start_time="2026-09-06 14:00:00",
        end_time="2026-09-06 14:30:00",
        duration_seconds=1800.0,
        category="Coding & Development",
    )
    assert event is not None

    # Schema validation via bridge helper
    model = bridge.validate_event(event)
    assert isinstance(model, ActivityEventV1)
    assert model.source.value == "system_agent"
    assert model.name == "pycharm64"
    assert model.duration == 1800
    assert model.category.value == "Coding & Development"


def test_14_idle_activity_does_not_become_active_duration(bridge):
    """14. Idle activity does not incorrectly become active duration."""
    # Case A: Entirely idle window session with drop_idle=True -> suppressed
    event_idle_dropped = bridge.process_window_event(
        process_name="code.exe",
        window_title="main.py",
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:15:00",
        duration_seconds=900.0,
        is_idle=True,
        idle_duration_seconds=900.0,
        drop_idle=True,
    )
    assert event_idle_dropped is None

    # Case B: Entirely idle window session with drop_idle=False -> duration is 0
    event_idle_zero = bridge.process_window_event(
        process_name="code.exe",
        window_title="main.py",
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:15:00",
        duration_seconds=900.0,
        is_idle=True,
        drop_idle=False,
    )
    assert event_idle_zero is not None
    assert event_idle_zero["duration"] == 0

    # Case C: Partially idle session (600s total, 400s idle -> 200s active)
    event_partial_idle = bridge.process_window_event(
        process_name="code.exe",
        window_title="main.py",
        start_time="2026-09-06 10:00:00",
        end_time="2026-09-06 10:10:00",
        duration_seconds=600.0,
        is_idle=False,
        idle_duration_seconds=400.0,
    )
    assert event_partial_idle is not None
    assert event_partial_idle["duration"] == 200


def test_15_adapt_team1_event_object_and_dict(bridge):
    """Bonus test: Verify adapt_team1_event accepts dictionary and object forms."""
    # Dict form
    event_dict = {
        "process_name": "sublime_text.exe",
        "window_title": "draft.txt",
        "start_time": "2026-09-06 11:00:00",
        "end_time": "2026-09-06 11:10:00",
        "duration_seconds": 600.0,
        "pid": 9999,
        "is_idle": False,
    }
    payload_dict = bridge.adapt_team1_event(event_dict)
    assert payload_dict is not None
    assert payload_dict["name"] == "sublime_text"
    assert "pid" not in payload_dict

    # Class / Object form
    class MockWindowEvent:
        process_name = "sublime_text.exe"
        window_title = "draft.txt"
        start_time = "2026-09-06 11:00:00"
        end_time = "2026-09-06 11:10:00"
        duration_seconds = 600.0
        pid = 9999
        is_idle = False
        idle_duration_seconds = 0.0

    payload_obj = bridge.adapt_team1_event(MockWindowEvent())
    assert payload_obj is not None
    assert payload_obj["name"] == "sublime_text"
    assert "pid" not in payload_obj
