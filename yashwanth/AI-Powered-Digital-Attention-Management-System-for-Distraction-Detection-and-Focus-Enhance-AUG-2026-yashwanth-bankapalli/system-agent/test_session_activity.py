"""
FocusGuard AI - Session Activity Calculation Test Suite (Phase 5)

Tests all Phase 5 requirements:
- TEST 1: 45-minute session with no idle period.
- TEST 2: 45-minute session with one 12-minute idle period (720s idle, 1980s active, 2700s duration).
- TEST 3: Multiple idle periods summed correctly.
- TEST 4: Activity resumes after idle (idle -> active, idle interval closed).
- TEST 5: Session change from GitHub -> YouTube (GitHub finalized independently, YouTube starts fresh).
- TEST 6: Active time + Idle time == Total duration invariant across various combinations.
- TEST 7: Very short sessions (0s, 1s, 5s) verify no negative durations.
- TEST 8: Session ends while user is idle (idle period properly clipped at session_end).
- TEST 9: Team 2 JSON format compliance (all 5 required fields + active_time and idle_time).
- TEST 10: Live session state calculation on ongoing sessions without ending session.
"""

import unittest
from session_activity import (
    SessionActivityCalculator,
    IDLE_THRESHOLD_SECONDS,
    clip_interval_to_range,
)


class TestSessionActivity(unittest.TestCase):

    def setUp(self):
        # Base epoch: 2026-09-01T10:00:00Z = 1788256800.0
        self.t0 = 1788256800.0
        self.calculator = SessionActivityCalculator(idle_threshold_seconds=IDLE_THRESHOLD_SECONDS)

    def test_1_continuous_session_no_idle(self):
        """
        TEST 1: 45-minute session with continuous activity (no idle period).
        Expected: duration = 2700s, idle_time = 0s, active_time = 2700s.
        """
        self.calculator.start_session("github.com", start_time=self.t0)

        # Simulate regular user activity every 2 minutes (120s < 600s threshold)
        for minute in range(2, 45, 2):
            self.calculator.record_activity(self.t0 + minute * 60)

        # Session ends at 45 minutes (2700s)
        session_end = self.t0 + 45 * 60
        summary = self.calculator.end_session(session_end)

        self.assertIsNotNone(summary)
        self.assertEqual(summary["domain"], "github.com")
        self.assertEqual(summary["duration"], 2700)
        self.assertEqual(summary["idle_time"], 0)
        self.assertEqual(summary["active_time"], 2700)
        self.assertEqual(summary["active_time"] + summary["idle_time"], summary["duration"])

    def test_2_session_with_one_twelve_minute_idle_period(self):
        """
        TEST 2: 45-minute session with one 12-minute idle period.
        - Session: 10:00 -> 10:45 (2700s)
        - User interacts normally until 10:20 (1200s)
        - User stops interacting at 10:20.
        - Threshold of 10 min (600s) reached at 10:30 (1800s) -> IDLE starts.
        - User resumes at 10:42 (2520s) -> 12 minutes of IDLE (720s).
        - User interacts from 10:42 -> 10:45.
        Expected: duration = 2700, idle_time = 720, active_time = 1980.
        """
        self.calculator.start_session("github.com", start_time=self.t0)

        # Interacts until 10:20 (+1200s)
        self.calculator.record_activity(self.t0 + 1200)

        # At 10:30 (+1800s), 10 min threshold is checked/reached -> Idle begins
        self.calculator.check_or_record_idle(self.t0 + 1800)

        # At 10:42 (+2520s), user resumes activity
        self.calculator.record_activity(self.t0 + 2520)

        # Session ends at 10:45 (+2700s)
        summary = self.calculator.end_session(self.t0 + 2700)

        self.assertIsNotNone(summary)
        self.assertEqual(summary["duration"], 2700)
        self.assertEqual(summary["idle_time"], 720)  # 12 min * 60s = 720s
        self.assertEqual(summary["active_time"], 1980) # 33 min * 60s = 1980s
        self.assertEqual(summary["active_time"] + summary["idle_time"], 2700)

    def test_3_multiple_idle_periods(self):
        """
        TEST 3: Multiple idle periods in a single session.
        - 10:00–10:20: Active (1200s)
        - 10:20–10:30: Threshold period (active)
        - 10:30–10:40: Idle period 1 = 10 mins (600s idle)
        - 10:40: Activity resumes
        - 10:40–10:50: Active (600s)
        - 10:50–11:00: Threshold period (active)
        - 11:00–11:05: Idle period 2 = 5 mins (300s idle)
        - 11:05: Activity resumes
        - 11:05–11:20: Active (900s)
        Total Session: 10:00–11:20 (80 minutes = 4800s).
        Expected: duration = 4800, idle_time = 900 (15 min), active_time = 3900 (65 min).
        """
        self.calculator.start_session("github.com", start_time=self.t0)

        # Period 1
        self.calculator.record_activity(self.t0 + 20 * 60) # 10:20
        self.calculator.check_or_record_idle(self.t0 + 30 * 60) # 10:30 -> idle starts
        self.calculator.record_activity(self.t0 + 40 * 60) # 10:40 -> idle ends (600s idle)

        # Period 2
        self.calculator.record_activity(self.t0 + 50 * 60) # 10:50
        self.calculator.check_or_record_idle(self.t0 + 60 * 60) # 11:00 -> idle starts
        self.calculator.record_activity(self.t0 + 65 * 60) # 11:05 -> idle ends (300s idle)

        # Final activity & end at 11:20
        self.calculator.record_activity(self.t0 + 80 * 60)
        summary = self.calculator.end_session(self.t0 + 80 * 60)

        self.assertEqual(summary["duration"], 4800)
        self.assertEqual(summary["idle_time"], 900)
        self.assertEqual(summary["active_time"], 3900)
        self.assertEqual(summary["active_time"] + summary["idle_time"], summary["duration"])

    def test_4_activity_resumes_after_idle(self):
        """
        TEST 4: Activity resumes after idle.
        Verify idle -> active transition and that idle period is terminated correctly.
        """
        self.calculator.start_session("docs.python.org", start_time=self.t0)
        self.calculator.record_activity(self.t0 + 100)

        # Inactive for 700s -> Idle begins at t0 + 100 + 600 = t0 + 700
        self.calculator.check_or_record_idle(self.t0 + 800)
        self.assertIsNotNone(self.calculator.current_idle_start)
        self.assertEqual(self.calculator.current_idle_start, self.t0 + 700)

        # Activity resumes at t0 + 1000
        self.calculator.record_activity(self.t0 + 1000)

        # Verify idle period closed
        self.assertIsNone(self.calculator.current_idle_start)
        self.assertEqual(len(self.calculator.completed_idle_periods), 1)
        self.assertEqual(
            self.calculator.completed_idle_periods[0],
            (self.t0 + 700, self.t0 + 1000),
        )

        # End session at t0 + 1200
        summary = self.calculator.end_session(self.t0 + 1200)
        self.assertEqual(summary["duration"], 1200)
        self.assertEqual(summary["idle_time"], 300)
        self.assertEqual(summary["active_time"], 900)

    def test_5_domain_switch_github_to_youtube(self):
        """
        TEST 5: Session changes from GitHub -> YouTube.
        Verify:
        - GitHub's activity summary is finalized independently.
        - YouTube starts fresh without carrying over GitHub's idle periods.
        """
        # 1. Start GitHub session
        self.calculator.start_session("github.com", start_time=self.t0)
        self.calculator.record_activity(self.t0 + 1000) # last active at t0+1000
        self.calculator.check_or_record_idle(self.t0 + 2000) # idle from t0+1600

        # GitHub session ends at t0 + 2000 while user was idle
        github_summary = self.calculator.end_session(self.t0 + 2000)

        self.assertEqual(github_summary["domain"], "github.com")
        self.assertEqual(github_summary["duration"], 2000)
        self.assertEqual(github_summary["idle_time"], 400) # (2000 - 1600) = 400s
        self.assertEqual(github_summary["active_time"], 1600)

        # 2. Start YouTube session fresh at t0 + 2000
        self.calculator.start_session("youtube.com", start_time=self.t0 + 2000)
        # Active throughout YouTube session
        self.calculator.record_activity(self.t0 + 2300)
        self.calculator.record_activity(self.t0 + 2600)

        youtube_summary = self.calculator.end_session(self.t0 + 2600)

        self.assertEqual(youtube_summary["domain"], "youtube.com")
        self.assertEqual(youtube_summary["duration"], 600)
        self.assertEqual(youtube_summary["idle_time"], 0)
        self.assertEqual(youtube_summary["active_time"], 600)

    def test_6_active_plus_idle_equals_duration_invariant(self):
        """
        TEST 6: Active + idle = total duration invariant across diverse scenarios.
        """
        test_cases = [
            (300, []), # 5 min session, 0 idle
            (1800, [(self.t0 + 700, self.t0 + 1000)]), # 30 min session, 300s idle
            (3600, [(self.t0 + 600, self.t0 + 1200), (self.t0 + 2000, self.t0 + 2500)]), # 1 hr session, 600+500=1100s idle
        ]

        for duration, idle_intervals in test_cases:
            calc = SessionActivityCalculator()
            int_dur, int_active, int_idle = calc.compute_durations(
                self.t0, self.t0 + duration, idle_intervals
            )
            self.assertEqual(int_active + int_idle, int_dur)
            self.assertGreaterEqual(int_active, 0)
            self.assertGreaterEqual(int_idle, 0)
            self.assertGreaterEqual(int_dur, 0)

    def test_7_short_sessions(self):
        """
        TEST 7: Very short sessions (0s, 1s, 5s).
        Verify no negative durations or unexpected crashes.
        """
        # 0s session
        self.calculator.start_session("google.com", start_time=self.t0)
        summary_0 = self.calculator.end_session(self.t0)
        self.assertEqual(summary_0["duration"], 0)
        self.assertEqual(summary_0["active_time"], 0)
        self.assertEqual(summary_0["idle_time"], 0)

        # 1s session
        self.calculator.start_session("google.com", start_time=self.t0)
        summary_1 = self.calculator.end_session(self.t0 + 1)
        self.assertEqual(summary_1["duration"], 1)
        self.assertEqual(summary_1["active_time"], 1)
        self.assertEqual(summary_1["idle_time"], 0)

        # 5s session
        self.calculator.start_session("google.com", start_time=self.t0)
        summary_5 = self.calculator.end_session(self.t0 + 5)
        self.assertEqual(summary_5["duration"], 5)
        self.assertEqual(summary_5["active_time"], 5)
        self.assertEqual(summary_5["idle_time"], 0)

    def test_8_session_ends_while_user_is_idle(self):
        """
        TEST 8: Session ends while user is idle.
        Verify the idle period is closed correctly at session_end:
        idle_end = min(activity_resume_time, session_end).
        """
        # Session 10:00 -> 10:35 (2100s)
        # Last active at 10:10 (600s)
        # Threshold reached at 10:20 (1200s) -> Idle starts at 10:20 (1200s)
        # User never resumed before session ended at 10:35 (2100s)
        # Expected idle: 1200s to 2100s = 900s (15 mins)
        # Expected active: 2100 - 900 = 1200s (20 mins)
        self.calculator.start_session("github.com", start_time=self.t0)
        self.calculator.record_activity(self.t0 + 600) # last active at 10:10
        self.calculator.check_or_record_idle(self.t0 + 2100) # evaluated at session end (10:35)

        summary = self.calculator.end_session(self.t0 + 2100)

        self.assertEqual(summary["duration"], 2100)
        self.assertEqual(summary["idle_time"], 900)
        self.assertEqual(summary["active_time"], 1200)
        self.assertEqual(summary["active_time"] + summary["idle_time"], 2100)

    def test_9_team2_json_format_compliance(self):
        """
        TEST 9: Verify Team 2 JSON record format compatibility.
        Must contain all 5 required Team 2 fields:
        - source
        - name
        - start_time
        - end_time
        - duration
        Plus active_time and idle_time.
        """
        self.calculator.start_session("github.com", start_time=self.t0)
        summary = self.calculator.end_session(self.t0 + 2700)

        team2_record = self.calculator.to_team2_format(summary)

        # Check required Team 2 fields
        self.assertIn("source", team2_record)
        self.assertEqual(team2_record["source"], "extension")
        self.assertIn("name", team2_record)
        self.assertEqual(team2_record["name"], "github.com")
        self.assertIn("start_time", team2_record)
        self.assertIn("end_time", team2_record)
        self.assertIn("duration", team2_record)
        self.assertEqual(team2_record["duration"], 2700)

        # Check Phase 5 & 6 fields
        self.assertIn("category", team2_record)
        self.assertEqual(team2_record["category"], "educational")
        self.assertIn("active_time", team2_record)
        self.assertIn("idle_time", team2_record)
        self.assertEqual(team2_record["active_time"] + team2_record["idle_time"], team2_record["duration"])

    def test_10_live_session_query(self):
        """
        TEST 10: Query live session state while session is ongoing without finalizing it.
        """
        self.calculator.start_session("github.com", start_time=self.t0)
        self.calculator.record_activity(self.t0 + 300)

        live_state = self.calculator.get_live_session_state(self.t0 + 600)
        self.assertIsNotNone(live_state)
        self.assertEqual(live_state["domain"], "github.com")
        self.assertEqual(live_state["category"], "educational")
        self.assertEqual(live_state["duration"], 600)
        self.assertEqual(live_state["idle_time"], 0)
        self.assertEqual(live_state["active_time"], 600)

        # Verify session is still ongoing
        self.assertIsNotNone(self.calculator.current_domain)

    def test_11_domain_classification(self):
        """
        TEST 11: Domain classification in Python system agent.
        """
        from session_activity import classify_domain
        self.assertEqual(classify_domain("github.com"), "educational")
        self.assertEqual(classify_domain("stackoverflow.com"), "educational")
        self.assertEqual(classify_domain("instagram.com"), "non_educational")
        self.assertEqual(classify_domain("netflix.com"), "non_educational")
        self.assertEqual(classify_domain("youtube.com"), "unknown")
        self.assertEqual(classify_domain("example.com"), "unknown")
        self.assertEqual(classify_domain("docs.github.com"), "educational")
        self.assertEqual(classify_domain("https://github.com/user/repo"), "educational")


if __name__ == "__main__":
    unittest.main(verbosity=2)
