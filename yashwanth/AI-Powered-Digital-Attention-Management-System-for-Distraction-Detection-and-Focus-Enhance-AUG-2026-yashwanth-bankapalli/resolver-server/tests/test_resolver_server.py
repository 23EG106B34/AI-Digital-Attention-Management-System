"""
FocusGuard AI - Resolver Server Unit & Integration Test Suite (Phase 7B)

Tests:
- TEST 1: POST leetcode.com -> educational
- TEST 2: POST github.com -> educational
- TEST 3: POST instagram.com -> non_educational
- TEST 4: POST youtube.com -> unknown
- TEST 5: unknown domain -> unknown
- TEST 6: malformed input -> validation failure (HTTP 422)
- TEST 7: full URL instead of hostname -> rejected (HTTP 422)
- TEST 8: query parameter input -> rejected (HTTP 422)
- TEST 9: low-confidence classification -> unknown
- TEST 10: .edu TLD educational heuristic
"""

import sys
from pathlib import Path
import unittest
from unittest.mock import patch

# Add parent directory to sys.path so resolver_server can be imported
server_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(server_dir))

from fastapi.testclient import TestClient
from resolver_server import app, CONFIDENCE_THRESHOLD, classify_domain_internally


class TestResolverServer(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_health_check(self):
        """Verify health check endpoint returns 200 OK."""
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_1_post_leetcode(self):
        """TEST 1: POST leetcode.com -> educational."""
        response = self.client.post("/classify-domain", json={"domain": "leetcode.com"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["domain"], "leetcode.com")
        self.assertEqual(data["category"], "educational")
        self.assertGreaterEqual(data["confidence"], CONFIDENCE_THRESHOLD)

    def test_2_post_github(self):
        """TEST 2: POST github.com -> educational."""
        response = self.client.post("/classify-domain", json={"domain": "github.com"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["domain"], "github.com")
        self.assertEqual(data["category"], "educational")

    def test_3_post_instagram(self):
        """TEST 3: POST instagram.com -> non_educational."""
        response = self.client.post("/classify-domain", json={"domain": "instagram.com"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["domain"], "instagram.com")
        self.assertEqual(data["category"], "non_educational")

    def test_4_post_youtube_mixed_content(self):
        """TEST 4: POST youtube.com -> unknown (mixed content policy)."""
        response = self.client.post("/classify-domain", json={"domain": "youtube.com"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["domain"], "youtube.com")
        self.assertEqual(data["category"], "unknown")
        self.assertEqual(data["confidence"], 0.50)

    def test_5_unknown_domain(self):
        """TEST 5: POST unlisted domain -> unknown."""
        with patch("resolver_server.classify_domain_with_llm", return_value=("unknown", 0.0, "unlisted_fallback")):
            response = self.client.post("/classify-domain", json={"domain": "example.com"})
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["domain"], "example.com")
            self.assertEqual(data["category"], "unknown")
            self.assertEqual(data["confidence"], 0.0)

            # Heuristic trap: study-crypto.com must NOT become educational
            response_trap = self.client.post("/classify-domain", json={"domain": "study-crypto.com"})
            self.assertEqual(response_trap.status_code, 200)
            self.assertEqual(response_trap.json()["category"], "unknown")

    def test_6_malformed_input(self):
        """TEST 6: Malformed domain input -> validation failure (HTTP 422)."""
        # Empty string
        res1 = self.client.post("/classify-domain", json={"domain": ""})
        self.assertEqual(res1.status_code, 422)

        # Invalid characters
        res2 = self.client.post("/classify-domain", json={"domain": "invalid domain with spaces.com"})
        self.assertEqual(res2.status_code, 422)

    def test_7_full_url_rejected(self):
        """TEST 7: Full URL instead of hostname -> rejected (HTTP 422)."""
        res = self.client.post(
            "/classify-domain",
            json={"domain": "https://leetcode.com/problemset/all/"},
        )
        self.assertEqual(res.status_code, 422)

    def test_8_query_param_rejected(self):
        """TEST 8: Query parameter input -> rejected (HTTP 422)."""
        res = self.client.post(
            "/classify-domain",
            json={"domain": "leetcode.com?user=123"},
        )
        self.assertEqual(res.status_code, 422)

    def test_9_low_confidence_classification(self):
        """TEST 9: Low-confidence classification -> unknown."""
        # Reddit has confidence 0.50 (< 0.80 threshold) -> evaluates to "unknown"
        response = self.client.post("/classify-domain", json={"domain": "reddit.com"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["category"], "unknown")

    def test_10_subdomain_and_edu_heuristics(self):
        """TEST 10: Subdomains and .edu TLD heuristic."""
        # Subdomain of leetcode
        res_sub = self.client.post("/classify-domain", json={"domain": "api.leetcode.com"})
        self.assertEqual(res_sub.status_code, 200)
        self.assertEqual(res_sub.json()["category"], "educational")

        # University .edu domain
        res_edu = self.client.post("/classify-domain", json={"domain": "cs.stanford.edu"})
        self.assertEqual(res_edu.status_code, 200)
        self.assertEqual(res_edu.json()["category"], "educational")


if __name__ == "__main__":
    unittest.main(verbosity=2)
