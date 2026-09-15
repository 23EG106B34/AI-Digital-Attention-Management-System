"""
FocusGuard AI - System-Level Activity Tracker Test Suite (Phase 4)

Tests all requirements:
- TEST 1: Activity occurs -> status is ACTIVE.
- TEST 2: No activity for less than threshold -> status remains ACTIVE.
- TEST 3: No activity for >= threshold -> status transitions to IDLE.
- TEST 4: User activity occurs after idle -> status transitions IDLE -> ACTIVE.
- TEST 5: Keyboard activity updates last_activity_time.
- TEST 6: Mouse activity updates last_activity_time.
- TEST 7: Verify that actual keyboard characters and mouse coordinates are NOT stored.
"""

import unittest
from datetime import datetime, timezone
from activity_tracker import ActivityTracker, IDLE_THRESHOLD_SECONDS, format_iso8601


class MockClock:
    """Mockable clock to simulate time passage without sleeping."""

    def __init__(self, initial_time: float = 1700000000.0):
        self._current_time = initial_time

    def time(self) -> float:
        return self._current_time

    def advance(self, seconds: float) -> None:
        self._current_time += seconds

    def set_time(self, timestamp: float) -> None:
        self._current_time = timestamp


class TestActivityTracker(unittest.TestCase):

    def setUp(self):
        self.mock_clock = MockClock(initial_time=1700000000.0)
        # Default production threshold is 600 seconds
        self.tracker = ActivityTracker(
            idle_threshold_seconds=IDLE_THRESHOLD_SECONDS,
            time_func=self.mock_clock.time,
        )

    def test_default_production_threshold(self):
        """Verify the production idle threshold constant is exactly 600 seconds (10 minutes)."""
        self.assertEqual(IDLE_THRESHOLD_SECONDS, 600.0)
        self.assertEqual(self.tracker.idle_threshold_seconds, 600.0)

    def test_1_activity_occurs_active(self):
        """TEST 1: Activity occurs. Expected: ACTIVE."""
        self.tracker.record_activity()
        state = self.tracker.get_state()

        self.assertEqual(state["status"], "active")
        self.assertIsNotNone(state["last_activity"])
        self.assertIsNone(state["idle_started_at"])
        self.assertEqual(state["idle_duration"], 0.0)

    def test_2_no_activity_less_than_threshold(self):
        """TEST 2: No activity for less than threshold. Expected: ACTIVE."""
        # Initial activity at t=0
        self.tracker.record_activity()

        # Advance time by 300 seconds (5 minutes, which is < 600s threshold)
        self.mock_clock.advance(300.0)
        state = self.tracker.get_state()

        self.assertEqual(state["status"], "active")
        self.assertIsNone(state["idle_started_at"])
        self.assertEqual(state["idle_duration"], 0.0)

        # Advance time to 599 seconds (< 600s)
        self.mock_clock.advance(299.0)
        state = self.tracker.get_state()

        self.assertEqual(state["status"], "active")
        self.assertIsNone(state["idle_started_at"])
        self.assertEqual(state["idle_duration"], 0.0)

    def test_3_no_activity_greater_equal_threshold(self):
        """TEST 3: No activity for >= 600 seconds. Expected: IDLE."""
        start_time = self.mock_clock.time()
        self.tracker.record_activity()

        # Advance time by exactly 600 seconds
        self.mock_clock.advance(600.0)
        state = self.tracker.get_state()

        self.assertEqual(state["status"], "idle")
        self.assertIsNotNone(state["idle_started_at"])
        self.assertEqual(state["idle_started_at"], format_iso8601(start_time + 600.0))
        self.assertEqual(state["idle_duration"], 600.0)

        # Advance further by another 120 seconds (total 720 seconds)
        self.mock_clock.advance(120.0)
        state = self.tracker.get_state()

        self.assertEqual(state["status"], "idle")
        self.assertEqual(state["idle_duration"], 720.0)

    def test_4_user_activity_after_idle(self):
        """TEST 4: User activity occurs after idle. Expected: IDLE -> ACTIVE."""
        transitions = []

        def on_change(new_state):
            transitions.append(new_state["status"])

        test_tracker = ActivityTracker(
            idle_threshold_seconds=600.0,
            time_func=self.mock_clock.time,
            on_state_change=on_change,
        )

        # User starts active
        test_tracker.record_activity()
        self.assertEqual(test_tracker.get_state()["status"], "active")

        # User is inactive for 650s -> becomes IDLE
        self.mock_clock.advance(650.0)
        idle_state = test_tracker.get_state()
        self.assertEqual(idle_state["status"], "idle")
        self.assertEqual(idle_state["idle_duration"], 650.0)

        # User presses a key or moves mouse
        self.tracker_resume_time = self.mock_clock.time()
        test_tracker.record_activity()

        resumed_state = test_tracker.get_state()
        self.assertEqual(resumed_state["status"], "active")
        self.assertIsNone(resumed_state["idle_started_at"])
        self.assertEqual(resumed_state["idle_duration"], 0.0)
        self.assertEqual(
            resumed_state["last_activity"],
            format_iso8601(self.tracker_resume_time),
        )

        # Verify state transition notifications
        self.assertIn("idle", transitions)
        self.assertIn("active", transitions)

    def test_5_keyboard_activity_updates_timestamp(self):
        """TEST 5: Keyboard activity updates last_activity_time."""
        initial_time = self.mock_clock.time()
        self.tracker.record_activity()

        self.mock_clock.advance(50.0)
        event_time = self.mock_clock.time()

        # Simulate keyboard press and release events
        self.tracker.on_key_press("dummy_key_A")
        self.assertEqual(self.tracker.last_activity_time, event_time)

        self.mock_clock.advance(20.0)
        release_time = self.mock_clock.time()
        self.tracker.on_key_release("dummy_key_A")
        self.assertEqual(self.tracker.last_activity_time, release_time)

    def test_6_mouse_activity_updates_timestamp(self):
        """TEST 6: Mouse activity updates last_activity_time."""
        self.mock_clock.advance(10.0)
        t1 = self.mock_clock.time()
        self.tracker.on_mouse_move(100, 200)
        self.assertEqual(self.tracker.last_activity_time, t1)

        self.mock_clock.advance(15.0)
        t2 = self.mock_clock.time()
        self.tracker.on_mouse_click(150, 250, "Button.left", True)
        self.assertEqual(self.tracker.last_activity_time, t2)

        self.mock_clock.advance(10.0)
        t3 = self.mock_clock.time()
        self.tracker.on_mouse_scroll(150, 250, 0, 1)
        self.assertEqual(self.tracker.last_activity_time, t3)

    def test_7_privacy_guarantee_no_sensitive_data_stored(self):
        """
        TEST 7: Verify that actual keyboard characters, coordinates,
        and typed text are NOT stored anywhere in the tracker's state or attributes.
        """
        sensitive_key = "SuperSecretPassword123"
        sensitive_x, sensitive_y = 1337, 4242

        # Send sensitive dummy events
        self.tracker.on_key_press(sensitive_key)
        self.tracker.on_key_release(sensitive_key)
        self.tracker.on_mouse_move(sensitive_x, sensitive_y)
        self.tracker.on_mouse_click(sensitive_x, sensitive_y, "Button.left", True)
        self.tracker.on_mouse_scroll(sensitive_x, sensitive_y, 0, 1)

        state = self.tracker.get_state()

        # 1. Inspect returned state dictionary
        state_repr = str(state)
        self.assertNotIn(sensitive_key, state_repr)
        self.assertNotIn(str(sensitive_x), state_repr)
        self.assertNotIn(str(sensitive_y), state_repr)

        # Expected keys in state are strictly limited to privacy-safe metadata
        self.assertEqual(
            set(state.keys()),
            {"status", "last_activity", "idle_started_at", "idle_duration"},
        )

        # 2. Inspect all instance attributes of tracker
        tracker_dict_repr = str(self.tracker.__dict__)
        self.assertNotIn(sensitive_key, tracker_dict_repr)
        self.assertNotIn(str(sensitive_x), tracker_dict_repr)
        self.assertNotIn(str(sensitive_y), tracker_dict_repr)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestActivityTracker)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        exit(1)
