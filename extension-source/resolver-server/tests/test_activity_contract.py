"""
FocusGuard AI - Common Activity Contract v1 Test Suite

Tests:
  Backward compatibility:
    BC-1: Existing Team 2 5-field payload passes validation
  Schema validation:
    SC-1:  Valid extension event
    SC-2:  Valid system_agent event
    SC-3:  Missing required field -> reject
    SC-4:  Invalid source value -> reject
    SC-5:  Negative duration -> reject
    SC-6:  Invalid category -> reject
    SC-7:  Invalid event_id -> reject
    SC-8:  Unknown field -> reject (extra=forbid)
    SC-9:  Raw window_title field -> reject (unknown field -> extra=forbid)
    SC-10: Full executable_path -> reject (forbidden in process_name validator)
    SC-11: Raw query/path in sanitized_pathname -> reject
    SC-12: Midnight ISO-8601 timestamp (day rollover)
    SC-13: Legacy HH:MM timestamps
    SC-14: duration = 0
  API endpoint tests:
    API-1: POST /validate-activity-event with valid Team 2 payload -> 200
    API-2: POST /validate-activity-event with valid system_agent event -> 200
    API-3: POST /validate-activity-event with missing field -> 422
    API-4: POST /validate-activity-event with banned window_title -> 422
    API-5: POST /validate-activity-event with full URL as name -> 422
  Team 1 adapter tests:
    T1-1:  to_common_format produces valid contract payload
    T1-2:  Browser process is suppressed (returns None)
    T1-3:  Raw window_title absent from output
    T1-4:  executable_path absent from output
    T1-5:  PID absent from output
    T1-6:  Category mapping works
"""

import sys
import os
import unittest
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Path setup — resolver-server is the CWD when this runs
# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.dirname(HERE)          # resolver-server/
AGENT_DIR = os.path.join(os.path.dirname(SERVER_DIR), "system-agent")

sys.path.insert(0, SERVER_DIR)
sys.path.insert(0, os.path.join(SERVER_DIR, "contracts"))
sys.path.insert(0, AGENT_DIR)

from activity_event import ActivityEventV1, ActivitySource, ActivityCategory
from pydantic import ValidationError
from fastapi.testclient import TestClient
from resolver_server import app

client = TestClient(app)


# ===========================================================================
# Helper
# ===========================================================================

def _make_valid_extension_payload(**overrides):
    base = {
        "source": "extension",
        "name": "github.com",
        "start_time": "09:00",
        "end_time": "09:30",
        "duration": 1800,
    }
    base.update(overrides)
    return base


def _make_valid_agent_payload(**overrides):
    base = {
        "source": "system_agent",
        "name": "Visual Studio Code",
        "start_time": "2026-09-06T09:00:00Z",
        "end_time": "2026-09-06T09:50:00Z",
        "duration": 2700,
    }
    base.update(overrides)
    return base


# ===========================================================================
# Backward Compatibility Tests
# ===========================================================================

class TestBackwardCompatibility(unittest.TestCase):

    def test_bc1_existing_team2_5_field_payload_passes(self):
        """BC-1: Exact existing Team 2 payload must pass without modification."""
        payload = {
            "source": "extension",
            "name": "github.com",
            "start_time": "09:00",
            "end_time": "09:30",
            "duration": 1800,
        }
        event = ActivityEventV1(**payload)
        self.assertEqual(event.source, ActivitySource.EXTENSION)
        self.assertEqual(event.name, "github.com")
        self.assertEqual(event.start_time, "09:00")
        self.assertEqual(event.end_time, "09:30")
        self.assertEqual(event.duration, 1800)
        self.assertIsNone(event.category)
        self.assertIsNone(event.process_name)


# ===========================================================================
# Schema Validation Tests
# ===========================================================================

class TestSchemaValidation(unittest.TestCase):

    # --- Valid events -------------------------------------------------------

    def test_sc1_valid_extension_event(self):
        """SC-1: Full valid extension event with all optional fields."""
        event = ActivityEventV1(
            source="extension",
            name="youtube.com",
            start_time="2026-09-06T09:30:00Z",
            end_time="2026-09-06T09:45:00Z",
            duration=900,
            category="Learning & Research",
            sanitized_title="MIT Lecture - Algorithms",
            sanitized_pathname="/watch",
            event_id="4a1d9990-2ef7-4c3e-b830-4e7a4b08f001",
        )
        self.assertEqual(event.source, ActivitySource.EXTENSION)
        self.assertEqual(event.category, ActivityCategory.LEARNING)
        self.assertEqual(event.sanitized_pathname, "/watch")

    def test_sc2_valid_system_agent_event(self):
        """SC-2: Full valid system_agent event."""
        event = ActivityEventV1(**_make_valid_agent_payload(
            category="Coding & Development",
            process_name="Code.exe",
            sanitized_title="activity_tracker.py - focusguard-extension",
            event_id="c3f4a221-4ab9-5e5a-d052-6a9c6d10b003",
        ))
        self.assertEqual(event.source, ActivitySource.SYSTEM_AGENT)
        self.assertEqual(event.process_name, "Code.exe")

    # --- Missing required fields --------------------------------------------

    def test_sc3_missing_required_field_rejected(self):
        """SC-3: Missing required field raises ValidationError."""
        with self.assertRaises(ValidationError):
            ActivityEventV1(
                source="extension",
                name="github.com",
                start_time="09:00",
                # end_time missing
                duration=1800,
            )
        with self.assertRaises(ValidationError):
            ActivityEventV1(
                source="extension",
                # name missing
                start_time="09:00",
                end_time="09:30",
                duration=1800,
            )

    # --- Invalid source -----------------------------------------------------

    def test_sc4_invalid_source_rejected(self):
        """SC-4: Unrecognised source value is rejected."""
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(source="desktop_agent"))

        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(source=""))

    # --- Negative duration --------------------------------------------------

    def test_sc5_negative_duration_rejected(self):
        """SC-5: Negative duration is rejected."""
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(duration=-1))

        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(duration=-100))

    # --- Invalid category ---------------------------------------------------

    def test_sc6_invalid_category_rejected(self):
        """SC-6: Category value outside approved taxonomy is rejected."""
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(category="Games"))

        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(category="educational"))

    # --- Invalid event_id ---------------------------------------------------

    def test_sc7_invalid_event_id_rejected(self):
        """SC-7: Malformed UUID in event_id is rejected."""
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(event_id="not-a-uuid"))

        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(event_id="1234"))

    # --- Unknown / banned fields --------------------------------------------

    def test_sc8_unknown_field_rejected(self):
        """SC-8: Unknown field is rejected by extra=forbid."""
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(unexpected_field="value"))

    def test_sc9_raw_window_title_rejected(self):
        """SC-9: window_title is a banned unknown field -> rejected."""
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(window_title="Some App - Document.docx"))

    def test_sc10_full_executable_path_rejected(self):
        """SC-10: executable_path is a banned unknown field -> rejected."""
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(
                executable_path=r"C:\Users\User\AppData\Local\Programs\code.exe"
            ))
        # Also test process_name validator rejecting full paths
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_agent_payload(
                process_name=r"C:\Users\User\AppData\Local\Programs\Code.exe"
            ))

    def test_sc11_raw_query_params_in_pathname_rejected(self):
        """SC-11: Query params or fragments in sanitized_pathname are rejected."""
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(
                sanitized_pathname="/watch?v=dQw4w9WgXcQ"
            ))
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(
                sanitized_pathname="/page#section"
            ))

    # --- Timestamp edge cases -----------------------------------------------

    def test_sc12_midnight_iso_timestamp(self):
        """SC-12: Midnight crossover ISO-8601 timestamp accepted."""
        event = ActivityEventV1(**_make_valid_agent_payload(
            start_time="2026-09-06T23:50:00Z",
            end_time="2026-09-07T00:10:00Z",
            duration=1200,
        ))
        self.assertEqual(event.start_time, "2026-09-06T23:50:00Z")
        self.assertEqual(event.end_time, "2026-09-07T00:10:00Z")

    def test_sc13_legacy_hhmm_timestamps_accepted(self):
        """SC-13: Legacy HH:MM timestamps are accepted (backward compat)."""
        event = ActivityEventV1(**_make_valid_extension_payload(
            start_time="23:59",
            end_time="23:59",
            duration=60,
        ))
        self.assertEqual(event.start_time, "23:59")
        self.assertEqual(event.end_time, "23:59")

        # Bad HH:MM forms must still be rejected
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(start_time="25:00"))
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(start_time="9:00"))  # Missing leading zero

    def test_sc14_duration_zero_accepted(self):
        """SC-14: duration=0 is valid (very short / same-second event)."""
        event = ActivityEventV1(**_make_valid_extension_payload(duration=0))
        self.assertEqual(event.duration, 0)

    # --- Name content validation --------------------------------------------

    def test_sc_name_full_url_rejected(self):
        """name must not be a full URL."""
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_extension_payload(
                name="https://github.com/user/repo"
            ))

    def test_sc_name_filesystem_path_rejected(self):
        """name must not be a filesystem path."""
        with self.assertRaises(ValidationError):
            ActivityEventV1(**_make_valid_agent_payload(
                name=r"C:\Users\admin\project"
            ))


# ===========================================================================
# API Endpoint Tests
# ===========================================================================

class TestValidateActivityEventEndpoint(unittest.TestCase):

    def test_api1_valid_team2_legacy_payload(self):
        """API-1: Exact Team 2 legacy 5-field payload -> HTTP 200."""
        response = client.post("/validate-activity-event", json={
            "source": "extension",
            "name": "github.com",
            "start_time": "09:00",
            "end_time": "09:30",
            "duration": 1800,
        })
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["valid"])
        self.assertEqual(data["source"], "extension")
        self.assertEqual(data["name"], "github.com")
        self.assertEqual(data["duration"], 1800)

    def test_api2_valid_system_agent_event(self):
        """API-2: Valid system_agent event -> HTTP 200."""
        response = client.post("/validate-activity-event", json={
            "source": "system_agent",
            "name": "Visual Studio Code",
            "start_time": "2026-09-06T10:00:00Z",
            "end_time": "2026-09-06T10:50:00Z",
            "duration": 2700,
            "category": "Coding & Development",
            "process_name": "Code.exe",
        })
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["valid"])
        self.assertEqual(data["source"], "system_agent")

    def test_api3_missing_field_returns_422(self):
        """API-3: Missing required field -> HTTP 422."""
        response = client.post("/validate-activity-event", json={
            "source": "extension",
            "name": "github.com",
            "start_time": "09:00",
            # duration missing
        })
        self.assertEqual(response.status_code, 422)

    def test_api4_banned_window_title_returns_422(self):
        """API-4: Banned window_title field -> HTTP 422 (extra=forbid)."""
        response = client.post("/validate-activity-event", json={
            "source": "extension",
            "name": "github.com",
            "start_time": "09:00",
            "end_time": "09:30",
            "duration": 1800,
            "window_title": "VS Code - secret_project/main.py",
        })
        self.assertEqual(response.status_code, 422)

    def test_api5_full_url_as_name_returns_422(self):
        """API-5: Full URL in name field -> HTTP 422."""
        response = client.post("/validate-activity-event", json={
            "source": "extension",
            "name": "https://github.com/user/repo?token=abc",
            "start_time": "09:00",
            "end_time": "09:30",
            "duration": 1800,
        })
        self.assertEqual(response.status_code, 422)


# ===========================================================================
# Team 1 Adapter Tests
# ===========================================================================

class TestTeam1Adapter(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        """Import adapter from system-agent directory."""
        from common_activity_contract import (
            to_common_format, is_browser_process, BROWSER_PROCESS_NAMES
        )
        cls.to_common_format = staticmethod(to_common_format)
        cls.is_browser_process = staticmethod(is_browser_process)
        cls.BROWSER_PROCESS_NAMES = BROWSER_PROCESS_NAMES

    def _make_adapter_call(self, **kwargs):
        defaults = dict(
            process_name="Code.exe",
            window_title="activity_tracker.py - focusguard-extension",
            start_time=datetime(2026, 9, 6, 9, 0, 0, tzinfo=timezone.utc),
            end_time=datetime(2026, 9, 6, 9, 50, 0, tzinfo=timezone.utc),
            duration_seconds=2700,
            executable_path=r"C:\Users\user\AppData\Local\Programs\Microsoft VS Code\Code.exe",
            team1_category="Coding & Development",
            pid=12345,
        )
        defaults.update(kwargs)
        return self.to_common_format(**defaults)

    def test_t1_1_produces_valid_contract_payload(self):
        """T1-1: Adapter output validates against ActivityEventV1 schema."""
        result = self._make_adapter_call()
        self.assertIsNotNone(result)
        # Must validate against the contract without raising
        event = ActivityEventV1(**result)
        self.assertEqual(event.source, ActivitySource.SYSTEM_AGENT)
        self.assertEqual(event.duration, 2700)

    def test_t1_2_browser_process_suppressed(self):
        """T1-2: Browser process returns None (extension is authoritative)."""
        for browser in ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe"]:
            result = self._make_adapter_call(process_name=browser)
            self.assertIsNone(result, f"Expected None for browser process: {browser}")

    def test_t1_3_raw_window_title_absent(self):
        """T1-3: Raw window_title is never in the output."""
        result = self._make_adapter_call()
        self.assertNotIn("window_title", result)

    def test_t1_4_executable_path_absent(self):
        """T1-4: Full executable_path is never in the output."""
        result = self._make_adapter_call()
        self.assertNotIn("executable_path", result)
        # process_name should be just the basename
        if "process_name" in result:
            self.assertNotIn("\\", result["process_name"])
            self.assertNotIn("Users", result["process_name"])

    def test_t1_5_pid_absent(self):
        """T1-5: PID is never forwarded in the contract payload."""
        result = self._make_adapter_call(pid=99999)
        self.assertNotIn("pid", result)
        self.assertNotIn("99999", str(result))

    def test_t1_6_category_mapping(self):
        """T1-6: Team 1 categories map correctly to contract taxonomy."""
        cases = [
            ("Coding & Development",    "Coding & Development"),
            ("Social Media & Messaging","Communication & Messaging"),
            ("Entertainment & Streaming","Entertainment & Streaming"),
            ("Productivity & Office",    "Productivity & Office"),
            ("System & Utilities",       "System & Utilities"),
            ("Learning on YouTube",      "Learning & Research"),
            ("Uncategorized / Browsing", "Unknown"),
        ]
        for team1_cat, expected_contract_cat in cases:
            result = self._make_adapter_call(team1_category=team1_cat)
            self.assertIsNotNone(result)
            self.assertEqual(result.get("category"), expected_contract_cat,
                             f"Mapping failed for {team1_cat!r}")

    def test_t1_7_is_browser_process_helper(self):
        """T1-7: is_browser_process returns correct booleans."""
        self.assertTrue(self.is_browser_process("chrome.exe"))
        self.assertTrue(self.is_browser_process("CHROME.EXE"))
        self.assertFalse(self.is_browser_process("Code.exe"))
        self.assertFalse(self.is_browser_process(""))

    def test_t1_8_duration_zero_allowed(self):
        """T1-8: Zero duration produces valid contract payload."""
        result = self._make_adapter_call(duration_seconds=0)
        self.assertIsNotNone(result)
        self.assertEqual(result["duration"], 0)
        event = ActivityEventV1(**result)
        self.assertEqual(event.duration, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
