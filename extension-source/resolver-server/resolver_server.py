"""
FocusGuard AI - Dynamic Domain Resolver Server (Phase 7B)

A lightweight, deterministic FastAPI backend service for classifying unknown
web domains into:
- 'educational'
- 'non_educational'
- 'unknown'

SECURITY & PRIVACY GUARANTEES:
- Binds strictly to 127.0.0.1 (local loopback interface).
- Accepts strictly normalized domain hostnames (no URLs, paths, or query params).
- Zero user tracking, zero IP logging, zero browsing history database.
"""

import re
from typing import Dict, Optional, Tuple
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator

# Minimum confidence required to emit 'educational' or 'non_educational'
CONFIDENCE_THRESHOLD: float = 0.80

# Valid output category values
VALID_CATEGORIES = {"educational", "non_educational", "unknown"}

# Server-side curated domain knowledge base
# Maps normalized domain -> (category, confidence, source)
SERVER_DOMAIN_REGISTRY: Dict[str, Tuple[str, float, str]] = {
    # High-confidence Educational Platforms
    "leetcode.com": ("educational", 0.95, "server_domain_db"),
    "github.com": ("educational", 0.95, "server_domain_db"),
    "stackoverflow.com": ("educational", 0.95, "server_domain_db"),
    "coursera.org": ("educational", 0.95, "server_domain_db"),
    "udemy.com": ("educational", 0.95, "server_domain_db"),
    "khanacademy.org": ("educational", 0.95, "server_domain_db"),
    "kaggle.com": ("educational", 0.95, "server_domain_db"),
    "codewars.com": ("educational", 0.95, "server_domain_db"),
    "hackerrank.com": ("educational", 0.95, "server_domain_db"),
    "w3schools.com": ("educational", 0.95, "server_domain_db"),
    "developer.mozilla.org": ("educational", 0.95, "server_domain_db"),
    "geeksforgeeks.org": ("educational", 0.95, "server_domain_db"),

    # High-confidence Non-Educational / Entertainment Platforms
    "instagram.com": ("non_educational", 0.95, "server_domain_db"),
    "netflix.com": ("non_educational", 0.95, "server_domain_db"),
    "tiktok.com": ("non_educational", 0.95, "server_domain_db"),
    "twitch.tv": ("non_educational", 0.95, "server_domain_db"),
    "twitter.com": ("non_educational", 0.95, "server_domain_db"),
    "x.com": ("non_educational", 0.95, "server_domain_db"),
    "facebook.com": ("non_educational", 0.95, "server_domain_db"),
    "disneyplus.com": ("non_educational", 0.95, "server_domain_db"),
    "hulu.com": ("non_educational", 0.95, "server_domain_db"),

    # Mixed-Content Platforms (Confidence 0.50 -> Evaluates to 'unknown')
    "youtube.com": ("unknown", 0.50, "mixed_content_policy"),
    "reddit.com": ("unknown", 0.50, "mixed_content_policy"),
    "google.com": ("unknown", 0.50, "mixed_content_policy"),
    "medium.com": ("unknown", 0.50, "mixed_content_policy"),
    "wikipedia.org": ("unknown", 0.50, "mixed_content_policy"),
}

# Regex to validate clean domain format (e.g., example.com, docs.python.org)
DOMAIN_REGEX = re.compile(
    r"^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$"
)


class DomainRequest(BaseModel):
    """Request payload containing normalized domain string and optional safe metadata."""
    domain: str = Field(
        ...,
        description="Normalized domain hostname (e.g., 'leetcode.com')",
        example="leetcode.com",
    )
    title: Optional[str] = Field(
        None,
        description="Sanitized page title (no control chars, max 120 chars)",
        example="Python Django Tutorial for Beginners",
    )
    pathname: Optional[str] = Field(
        None,
        description="Sanitized URL pathname (no query params or sensitive segments)",
        example="/watch",
    )

    @validator("domain")
    def validate_domain(cls, v: str) -> str:
        if not v or not isinstance(v, str):
            raise ValueError("Domain must be a non-empty string.")

        cleaned = v.strip().lower()

        # Reject full URLs, schemes, query parameters, paths, or fragments
        if "://" in cleaned or cleaned.startswith("http"):
            raise ValueError("Full URLs are not allowed. Provide hostname only (e.g. 'leetcode.com').")
        if "/" in cleaned:
            raise ValueError("URL paths are not allowed in domain field. Provide hostname only.")
        if "?" in cleaned:
            raise ValueError("Query parameters are not allowed in domain field.")
        if "#" in cleaned:
            raise ValueError("URL fragments are not allowed in domain field.")
        if ":" in cleaned:
            raise ValueError("Port numbers are not allowed in domain field.")

        # Remove leading www. if present
        if cleaned.startswith("www."):
            cleaned = cleaned[4:]

        if not DOMAIN_REGEX.match(cleaned):
            raise ValueError(f"Invalid domain format: '{v}'")

        return cleaned

    @validator("title")
    def validate_title(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = re.sub(r"[\x00-\x1F\x7F]", " ", str(v))
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned[:120] if cleaned else None

    @validator("pathname")
    def validate_pathname(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = str(v).strip()
        if "?" in cleaned or "#" in cleaned:
            cleaned = cleaned.split("?")[0].split("#")[0]
        return cleaned if cleaned else "/"


class DomainResponse(BaseModel):
    """Classification response schema."""
    domain: str
    category: str
    confidence: float
    source: str


def classify_domain_internally(clean_domain: str) -> Tuple[str, float, str]:
    """
    Internal rule and database evaluation engine for normalized domains.

    Returns:
        (category, confidence, source)
    """
    # 1. Direct match in server registry
    if clean_domain in SERVER_DOMAIN_REGISTRY:
        raw_cat, conf, src = SERVER_DOMAIN_REGISTRY[clean_domain]
        # Apply confidence threshold
        final_cat = raw_cat if conf >= CONFIDENCE_THRESHOLD else "unknown"
        return final_cat, conf, src

    # 2. Subdomain resolution to registered parent domain (e.g. play.leetcode.com -> leetcode.com)
    parts = clean_domain.split(".")
    for i in range(1, len(parts) - 1):
        parent_domain = ".".join(parts[i:])
        if parent_domain in SERVER_DOMAIN_REGISTRY:
            raw_cat, conf, src = SERVER_DOMAIN_REGISTRY[parent_domain]
            final_cat = raw_cat if conf >= CONFIDENCE_THRESHOLD else "unknown"
            return final_cat, conf, f"{src}_subdomain"

    # 3. High-confidence TLD heuristics (e.g., .edu, .ac.uk, .gov)
    if clean_domain.endswith(".edu") or clean_domain.endswith(".ac.uk"):
        return "educational", 0.90, "tld_heuristic_edu"

    # 4. Unlisted / unknown domain
    return "unknown", 0.0, "unlisted_fallback"


from llm_classifier import classify_domain_with_llm, generate_productivity_suggestion

# Common Activity Contract v1 — import the authoritative schema
import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.dirname(__file__))
from contracts.activity_event import ActivityEventV1


# Initialize FastAPI Application
app = FastAPI(
    title="FocusGuard AI - Domain Resolver",
    description="Deterministic local classification service with LLM fallback for unknown web domains.",
    version="1.0.0",
)

# Configure CORS for local browser extension communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "*",  # Allow local extension contexts
    ],
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint to verify resolver availability."""
    return {"status": "ok", "service": "focusguard-resolver", "version": "1.0.0"}


@app.post(
    "/classify-domain",
    response_model=DomainResponse,
    status_code=status.HTTP_200_OK,
    tags=["Classification"],
)
async def classify_domain_endpoint(payload: DomainRequest):
    """
    Classify a normalized web domain and optional safe metadata into 'educational', 'non_educational', or 'unknown'.
    Applies deterministic registry first; for unlisted or mixed-content domains with metadata, falls back to Groq.

    - **domain**: Normalized hostname string (e.g., "leetcode.com", "youtube.com")
    - **title**: Optional sanitized page title
    - **pathname**: Optional sanitized URL pathname
    """
    clean_domain = payload.domain

    # 1. Deterministic Knowledge Base & Heuristic Evaluation
    category, confidence, source = classify_domain_internally(clean_domain)

    # 2. LLM Fallback for Unlisted Domains or Mixed-Content Domains with Metadata
    has_metadata = bool(payload.title and payload.title.strip())
    is_mixed = source == "mixed_content_policy"
    is_unlisted = category == "unknown" and source == "unlisted_fallback"
    is_github_with_metadata = clean_domain == "github.com" and has_metadata

    if is_unlisted or (is_mixed and has_metadata) or is_github_with_metadata:
        llm_cat, llm_conf, llm_src = classify_domain_with_llm(
            domain=clean_domain,
            title=payload.title,
            pathname=payload.pathname,
        )
        category, confidence, source = llm_cat, llm_conf, llm_src

    # Sanity check on category
    if category not in VALID_CATEGORIES:
        category = "unknown"

    return DomainResponse(
        domain=clean_domain,
        category=category,
        confidence=confidence,
        source=source,
    )


class SuggestionRequest(BaseModel):
    """Productivity metrics payload for personalized suggestions."""
    score: float = Field(..., ge=0.0, le=100.0, description="Productivity Score (0-100)", example=42.0)
    label: str = Field(..., description="Productivity Label", example="Low Productivity")
    active_seconds: int = Field(0, ge=0, description="Total active duration in seconds")
    idle_seconds: int = Field(0, ge=0, description="Total idle duration in seconds")
    educational_seconds: int = Field(0, ge=0, description="Total educational duration in seconds")
    non_educational_seconds: int = Field(0, ge=0, description="Total non-educational duration in seconds")
    unknown_seconds: int = Field(0, ge=0, description="Total unknown duration in seconds")
    total_switches: int = Field(0, ge=0, description="Total domain/tab switch count")
    quick_switches: int = Field(0, ge=0, description="Total quick switch count (<60s)")
    quick_switch_ratio: float = Field(0.0, ge=0.0, le=1.0, description="Ratio of quick switches")


class SuggestionResponse(BaseModel):
    """Personalized productivity suggestion response schema."""
    suggestion: str
    reason: str
    source: str


@app.post(
    "/suggest",
    response_model=SuggestionResponse,
    status_code=status.HTTP_200_OK,
    tags=["Suggestions"],
)
async def get_productivity_suggestion_endpoint(payload: SuggestionRequest):
    """
    Generates a concise, actionable productivity suggestion from existing FocusGuard metrics.
    Deterministic for 'No Data' state; uses Groq with safe fallback on any failure.
    """
    result = generate_productivity_suggestion(payload.dict())
    response = SuggestionResponse(**result)

    score_display = int(payload.score) if int(payload.score) == payload.score else payload.score
    source_label_map = {
        "groq": "GROQ (new generation)",
        "cache": "CACHE (60-second reuse)",
        "deterministic": "DETERMINISTIC (no activity data)",
        "fallback": "FALLBACK (safe fallback)",
    }
    source_display = source_label_map.get(response.source.lower(), response.source.upper())

    print(
        f"[FocusGuard] Productivity Suggestion\n"
        f"Score: {score_display}\n"
        f"Reason: {response.reason}\n"
        f"Suggestion: {response.suggestion}\n"
        f"Source: {source_display}",
        flush=True,
    )

    return response


# ---------------------------------------------------------------------------
# Common Activity Contract v1 — Validation Endpoint
# ---------------------------------------------------------------------------

class ActivityEventValidationResponse(BaseModel):
    """Response from the activity-event validation endpoint."""
    valid: bool
    source: Optional[str] = None
    name: Optional[str] = None
    duration: Optional[int] = None
    message: str = "ok"


@app.post(
    "/validate-activity-event",
    response_model=ActivityEventValidationResponse,
    status_code=status.HTTP_200_OK,
    tags=["Contract"],
)
async def validate_activity_event_endpoint(payload: ActivityEventV1):
    """
    Validate an incoming activity event against the Common Activity Contract v1.

    Accepts events from both producers:
      - source="extension"     (Team 2 Chrome Extension)
      - source="system_agent" (Team 1 Windows desktop agent)

    Team 2 legacy payloads with 5 fields pass validation unchanged.
    Banned fields (window_title, executable_path, pid, etc.) are rejected
    automatically by the schema (extra="forbid").

    Returns HTTP 200 on success, HTTP 422 on validation failure.
    """
    return ActivityEventValidationResponse(
        valid=True,
        source=payload.source.value,
        name=payload.name,
        duration=payload.duration,
        message="Activity event is valid under Common Activity Contract v1.",
    )


if __name__ == "__main__":
    import uvicorn

    # Bind strictly to local loopback (127.0.0.1) for security
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
