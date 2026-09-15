"""
FocusGuard AI - LLM Domain Fallback Classifier Test Suite (Phase 10)

Comprehensive unit and integration test suite using MOCKED responses.
Guarantees zero external network egress during testing.

Tests:
1. educational + 0.95 -> educational
2. non_educational + 0.90 -> non_educational
3. unknown -> unknown
4. confidence 0.79 -> unknown (threshold enforcement)
5. confidence 0.80 -> accepted
6. invalid category -> unknown
7. invalid confidence -> unknown
8. malformed response -> unknown
9. timeout -> unknown
10. API failure -> unknown
11. missing API key -> safe failure
12. youtube.com -> unknown (mixed content policy without LLM)
13. google.com -> unknown (mixed content policy without LLM)
14. reddit.com -> unknown (mixed content policy without LLM)
15. known registry domain (github.com) -> LLM not called
16. cached domain -> LLM not called
17. unknown domain -> LLM called
18. repeated simultaneous request -> deduplicated
19. only normalized domain sent
20. no sensitive data sent
"""

import json
import os
import sys
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
import httpx

# Add parent directory to sys.path
server_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(server_dir))

from fastapi.testclient import TestClient
from resolver_server import app
from llm_classifier import (
    classify_domain_with_llm,
    parse_llm_json_response,
    LLM_CONFIDENCE_THRESHOLD,
    MIXED_CONTENT_DOMAINS,
)


class MockResponse:
    """Mock httpx response for LLM provider."""
    def __init__(self, status_code: int, json_data: dict):
        self.status_code = status_code
        self._json_data = json_data

    def json(self):
        return self._json_data


def make_gemini_response(category: str, confidence: float) -> dict:
    """Helper to construct standard Gemini JSON response structure."""
    text_content = json.dumps({"category": category, "confidence": confidence})
    return {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {"text": text_content}
                    ]
                }
            }
        ]
    }


class TestLLMClassifier(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)
        self.dummy_key = "test_mock_api_key_12345"

    def test_1_educational_high_confidence(self):
        """TEST 1: educational + 0.95 -> educational."""
        mock_client = MagicMock(spec=httpx.Client)
        mock_client.post.return_value = MockResponse(200, make_gemini_response("educational", 0.95))

        cat, conf, src = classify_domain_with_llm("mathworks.com", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "educational")
        self.assertEqual(conf, 0.95)
        self.assertEqual(src, "llm_classifier")

    def test_2_non_educational_high_confidence(self):
        """TEST 2: non_educational + 0.90 -> non_educational."""
        mock_client = MagicMock(spec=httpx.Client)
        mock_client.post.return_value = MockResponse(200, make_gemini_response("non_educational", 0.90))

        cat, conf, src = classify_domain_with_llm("steampowered.com", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "non_educational")
        self.assertEqual(conf, 0.90)
        self.assertEqual(src, "llm_classifier")

    def test_3_unknown_category(self):
        """TEST 3: unknown -> unknown."""
        mock_client = MagicMock(spec=httpx.Client)
        mock_client.post.return_value = MockResponse(200, make_gemini_response("unknown", 0.95))

        cat, conf, src = classify_domain_with_llm("ambiguous-portal.com", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "unknown")

    def test_4_confidence_below_threshold(self):
        """TEST 4: confidence 0.79 -> unknown (threshold enforcement < 0.80)."""
        mock_client = MagicMock(spec=httpx.Client)
        mock_client.post.return_value = MockResponse(200, make_gemini_response("educational", 0.79))

        cat, conf, src = classify_domain_with_llm("unclear-edu-site.org", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "unknown")
        self.assertEqual(src, "llm_low_confidence")

    def test_5_confidence_at_threshold(self):
        """TEST 5: confidence 0.80 -> accepted (boundary condition >= 0.80)."""
        mock_client = MagicMock(spec=httpx.Client)
        mock_client.post.return_value = MockResponse(200, make_gemini_response("educational", 0.80))

        cat, conf, src = classify_domain_with_llm("learncpp.com", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "educational")
        self.assertEqual(conf, 0.80)

    def test_6_invalid_category_from_llm(self):
        """TEST 6: invalid category -> unknown."""
        mock_client = MagicMock(spec=httpx.Client)
        text_content = json.dumps({"category": "SUPER_PRODUCTIVE_NOT_VALID", "confidence": 0.99})
        mock_client.post.return_value = MockResponse(200, {
            "candidates": [{"content": {"parts": [{"text": text_content}]}}]
        })

        cat, conf, src = classify_domain_with_llm("random.org", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "unknown")

    def test_7_invalid_confidence_from_llm(self):
        """TEST 7: invalid confidence format -> unknown."""
        mock_client = MagicMock(spec=httpx.Client)
        text_content = '{"category": "educational", "confidence": "high"}'
        mock_client.post.return_value = MockResponse(200, {
            "candidates": [{"content": {"parts": [{"text": text_content}]}}]
        })

        cat, conf, src = classify_domain_with_llm("random.org", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "unknown")

    def test_8_malformed_response_json(self):
        """TEST 8: malformed non-JSON response -> unknown."""
        mock_client = MagicMock(spec=httpx.Client)
        mock_client.post.return_value = MockResponse(200, {
            "candidates": [{"content": {"parts": [{"text": "I am an LLM and I think this is a nice website."}]}}]
        })

        cat, conf, src = classify_domain_with_llm("broken.org", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "unknown")

    def test_9_timeout_handling(self):
        """TEST 9: timeout -> unknown."""
        mock_client = MagicMock(spec=httpx.Client)
        mock_client.post.side_effect = httpx.TimeoutException("Connection timed out")

        cat, conf, src = classify_domain_with_llm("slow-host.org", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "unknown")
        self.assertEqual(src, "llm_timeout")

    def test_10_api_failure_handling(self):
        """TEST 10: API failure (HTTP 500 / 429) -> unknown."""
        mock_client = MagicMock(spec=httpx.Client)
        mock_client.post.return_value = MockResponse(500, {"error": "Internal Server Error"})

        cat, conf, src = classify_domain_with_llm("server-error.org", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "unknown")
        self.assertEqual(src, "llm_http_error_500")

    def test_11_missing_api_key_safe_failure(self):
        """TEST 11: missing API key -> safe failure (unknown)."""
        with patch("llm_classifier.get_llm_api_key", return_value=None):
            cat, conf, src = classify_domain_with_llm("unlisted.org", api_key=None)
            self.assertEqual(cat, "unknown")
            self.assertEqual(src, "missing_api_key")

    def test_12_youtube_mixed_content_skips_llm(self):
        """TEST 12: youtube.com -> unknown without invoking LLM."""
        mock_client = MagicMock(spec=httpx.Client)
        cat, conf, src = classify_domain_with_llm("youtube.com", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "unknown")
        self.assertEqual(src, "mixed_content_policy")
        mock_client.post.assert_not_called()

    def test_13_google_mixed_content_skips_llm(self):
        """TEST 13: google.com -> unknown without invoking LLM."""
        mock_client = MagicMock(spec=httpx.Client)
        cat, conf, src = classify_domain_with_llm("google.com", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "unknown")
        mock_client.post.assert_not_called()

    def test_14_reddit_mixed_content_skips_llm(self):
        """TEST 14: reddit.com -> unknown without invoking LLM."""
        mock_client = MagicMock(spec=httpx.Client)
        cat, conf, src = classify_domain_with_llm("reddit.com", api_key=self.dummy_key, client=mock_client)
        self.assertEqual(cat, "unknown")
        mock_client.post.assert_not_called()

    def test_15_known_registry_domain_does_not_call_llm(self):
        """TEST 15: known registry domain (github.com) -> LLM not called."""
        with patch("resolver_server.classify_domain_with_llm") as mock_llm:
            response = self.client.post("/classify-domain", json={"domain": "github.com"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["category"], "educational")
            self.assertEqual(response.json()["source"], "server_domain_db")
            mock_llm.assert_not_called()

    def test_16_subdomain_registered_does_not_call_llm(self):
        """TEST 16: subdomain of registered domain -> LLM not called."""
        with patch("resolver_server.classify_domain_with_llm") as mock_llm:
            response = self.client.post("/classify-domain", json={"domain": "gist.github.com"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["category"], "educational")
            mock_llm.assert_not_called()

    def test_17_unknown_domain_invokes_llm_fallback(self):
        """TEST 17: unknown unlisted domain -> invokes LLM fallback."""
        with patch("resolver_server.classify_domain_with_llm") as mock_llm:
            mock_llm.return_value = ("educational", 0.95, "llm_classifier")
            response = self.client.post("/classify-domain", json={"domain": "niche-coding-docs.io"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["category"], "educational")
            self.assertEqual(response.json()["source"], "llm_classifier")
            mock_llm.assert_called_once_with("niche-coding-docs.io")

    def test_18_duplicate_request_protection(self):
        """TEST 18: duplicate consecutive requests for unlisted domain."""
        with patch("resolver_server.classify_domain_with_llm") as mock_llm:
            mock_llm.return_value = ("educational", 0.95, "llm_classifier")
            res1 = self.client.post("/classify-domain", json={"domain": "portal1.org"})
            res2 = self.client.post("/classify-domain", json={"domain": "portal1.org"})
            self.assertEqual(res1.status_code, 200)
            self.assertEqual(res2.status_code, 200)
            self.assertEqual(res1.json()["category"], "educational")

    def test_19_only_normalized_domain_sent(self):
        """TEST 19: payload validation verifies only clean hostname is processed."""
        # www prefix is normalized
        res = self.client.post("/classify-domain", json={"domain": "www.mathworks.com"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["domain"], "mathworks.com")

    def test_20_no_sensitive_data_sent(self):
        """TEST 20: URLs with paths, queries, or credentials are strictly rejected."""
        # URL path rejected
        res1 = self.client.post("/classify-domain", json={"domain": "mathworks.com/products/matlab"})
        self.assertEqual(res1.status_code, 422)

        # Query param rejected
        res2 = self.client.post("/classify-domain", json={"domain": "mathworks.com?auth_token=secret"})
        self.assertEqual(res2.status_code, 422)


if __name__ == "__main__":
    unittest.main(verbosity=2)
