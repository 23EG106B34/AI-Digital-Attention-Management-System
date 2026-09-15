"""
FocusGuard AI - LLM Unknown Domain Fallback Classifier (Phase 10)

Provides an asynchronous/synchronous fallback mechanism using an LLM (e.g. Gemini 1.5 Flash)
to classify obscure or uncataloged domains into:
- 'educational'
- 'non_educational'
- 'unknown'

SECURITY & PRIVACY GUARANTEES:
- Transmits solely the normalized domain string.
- Zero secret keys in client-side code; LLM_API_KEY read exclusively from server environment.
- Strict 3.0-second timeout with non-blocking graceful fallback on any error.
- Confidence thresholding (>= 0.80 required).
"""

import json
import os
import re
from pathlib import Path
from typing import Optional, Tuple
import httpx

# Confidence threshold: category must have >= 0.80 confidence
LLM_CONFIDENCE_THRESHOLD: float = 0.80

# Valid category names
VALID_CATEGORIES = {"educational", "non_educational", "unknown"}

# Known mixed-content domains that must never be forced to educational/non_educational
MIXED_CONTENT_DOMAINS = {
    "youtube.com",
    "reddit.com",
    "google.com",
    "medium.com",
    "wikipedia.org",
    "twitter.com",
    "x.com",
}

# System prompt enforcing strict structured JSON output
SYSTEM_PROMPT = """You are an objective web domain classifier for FocusGuard AI.
Classify the general purpose of the given domain into exactly one category:
- "educational": Technical documentation, coding practice, e-learning platforms, academic portals, tutorials.
- "non_educational": Social media, entertainment streaming, gaming, general consumer shopping.
- "unknown": Mixed-content platforms (e.g. YouTube, Reddit, Google), multi-purpose platforms, search engines, or ambiguous websites.

Output strictly valid JSON with no markdown formatting:
{
  "category": "educational" | "non_educational" | "unknown",
  "confidence": <float between 0.0 and 1.0>
}"""


def get_llm_api_key() -> Optional[str]:
    """Retrieves LLM API key from server environment variables or .env file without logging secrets."""
    key = os.environ.get("LLM_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if key:
        return key.strip()

    # Check local .env file in resolver-server directory
    env_path = Path(__file__).resolve().parent / ".env"
    if env_path.exists():
        try:
            for line in env_path.read_text().splitlines():
                line = line.strip()
                if line.startswith("LLM_API_KEY=") or line.startswith("GEMINI_API_KEY="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if val:
                        return val
        except Exception:
            pass
    return None


def parse_llm_json_response(raw_text: str) -> Tuple[str, float]:
    """
    Safely extracts and validates category and confidence from raw LLM output.

    Returns:
        (category, confidence)
    """
    if not raw_text or not isinstance(raw_text, str):
        return "unknown", 0.0

    # Strip markdown code blocks if present
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
    except Exception:
        # Attempt regex extraction if JSON decoding fails
        cat_match = re.search(r'"category"\s*:\s*"([^"]+)"', cleaned)
        conf_match = re.search(r'"confidence"\s*:\s*([0-9.]+)', cleaned)
        if cat_match:
            raw_cat = cat_match.group(1).lower().strip()
            raw_conf = float(conf_match.group(1)) if conf_match else 0.0
            data = {"category": raw_cat, "confidence": raw_conf}
        else:
            return "unknown", 0.0

    category = str(data.get("category", "unknown")).lower().strip()
    if category not in VALID_CATEGORIES:
        return "unknown", 0.0

    try:
        confidence = float(data.get("confidence", 0.0))
        confidence = max(0.0, min(1.0, confidence))
    except (ValueError, TypeError):
        return "unknown", 0.0

    return category, confidence


def get_llm_model() -> str:
    """Retrieves LLM model name from server environment variables or .env file, defaulting to gemini-3.5-flash-lite."""
    model = os.environ.get("LLM_MODEL")
    if model:
        return model.strip()

    env_path = Path(__file__).resolve().parent / ".env"
    if env_path.exists():
        try:
            for line in env_path.read_text().splitlines():
                line = line.strip()
                if line.startswith("LLM_MODEL="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if val:
                        return val
        except Exception:
            pass
    return "gemini-3.5-flash-lite"


def classify_domain_with_llm(
    domain: str,
    api_key: Optional[str] = None,
    timeout_seconds: float = 3.0,
    client: Optional[httpx.Client] = None,
) -> Tuple[str, float, str]:
    """
    Classifies an unlisted domain using an LLM provider fallback.

    Args:
        domain: Normalized domain string (e.g. 'leetcode.com')
        api_key: Optional API key override (defaults to server env var)
        timeout_seconds: Request timeout in seconds (default 3.0s)
        client: Optional httpx.Client for testing / dependency injection

    Returns:
        (category, confidence, source)
    """
    if not domain or not isinstance(domain, str):
        return "unknown", 0.0, "invalid_domain_input"

    clean_domain = domain.strip().lower()

    # Rule: Mixed-content domains evaluate immediately to "unknown" without calling LLM
    if clean_domain in MIXED_CONTENT_DOMAINS:
        return "unknown", 0.50, "mixed_content_policy"

    key = api_key or get_llm_api_key()
    if not key:
        # Missing API key - safe graceful degradation to unknown
        return "unknown", 0.0, "missing_api_key"

    model = get_llm_model()
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": f"{SYSTEM_PROMPT}\n\nDomain to classify: {clean_domain}"}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.0,
            "responseMimeType": "application/json"
        }
    }

    try:
        http_client = client or httpx.Client(timeout=timeout_seconds)
        should_close = client is None

        try:
            response = http_client.post(endpoint, json=payload)
            if response.status_code != 200:
                return "unknown", 0.0, f"llm_http_error_{response.status_code}"

            resp_json = response.json()
            candidates = resp_json.get("candidates", [])
            if not candidates:
                return "unknown", 0.0, "llm_empty_candidates"

            content_parts = candidates[0].get("content", {}).get("parts", [])
            if not content_parts:
                return "unknown", 0.0, "llm_empty_parts"

            raw_text = content_parts[0].get("text", "")
            category, confidence = parse_llm_json_response(raw_text)

            # Apply Confidence Threshold (>= 0.80)
            if confidence >= LLM_CONFIDENCE_THRESHOLD and category in ("educational", "non_educational"):
                return category, confidence, "llm_classifier"

            return "unknown", confidence, "llm_low_confidence"

        finally:
            if should_close:
                http_client.close()

    except httpx.TimeoutException:
        return "unknown", 0.0, "llm_timeout"
    except Exception:
        # Safe silent fallback on network / JSON error
        return "unknown", 0.0, "llm_request_failed"
