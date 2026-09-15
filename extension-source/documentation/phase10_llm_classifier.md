# FocusGuard AI – Phase 10 Architectural Design Document
## LLM-Based Unknown Domain Fallback Classifier

> **Status**: Implemented & Verified (Phase 10)  
> **Target System**: FocusGuard AI (Backend Resolver Service Integration)  
> **Author**: FocusGuard AI Engineering Team  

---

## 1. Executive Summary & Objective

In **Phases 1–9**, FocusGuard AI implemented an end-to-end telemetry, presence tracking, domain classification, and distraction notification pipeline.
The objective of **Phase 10** is to add an **LLM Fallback Mechanism** strictly inside the local FastAPI resolver service to classify previously unknown / obscure domains into:
1. `educational`
2. `non_educational`
3. `unknown`

> [!IMPORTANT]
> The LLM is strictly a fallback classification engine. It is NOT responsible for session tracking, active/idle calculation, switch counting, distraction evaluation, or notifications.

---

## 2. Multi-Tiered Classification Architecture

```
                      Browser Extension (Tab Opened)
                                    │
                                    ▼
                      Normalize Domain (e.g. "mathworks.com")
                                    │
                                    ▼
                      Tier 1: Static Registry (0ms)
                                    │ (Miss)
                                    ▼
                      Tier 2: chrome.storage.local Cache (0ms)
                                    │ (Miss)
                                    ▼
                 Emit "unknown" (Session starts at t=0 without blocking)
                                    │
                                    ▼ (Async Background Resolution)
                 POST http://127.0.0.1:8000/classify-domain
                                    │
                                    ▼
                     FastAPI Resolver (127.0.0.1:8000)
                                    │
                        In Server-Side Registry?
                         /                     \
                       YES                      NO
                       /                         \
           Return Category                        ▼
           (server_domain_db)         Tier 3: LLM Fallback (Gemini 1.5 Flash)
                                      • Input: {"domain": "mathworks.com"}
                                      • Output: {"category": "educational", "confidence": 0.95}
                                      • Threshold: Confidence >= 0.80
                                                 │
                                                 ▼
                                    Save to Extension Cache
                                  (30-Day TTL, 2,000 items max)
                                                 │
                                                 ▼
                               Subsequent visits resolve in 0ms from cache
```

---

## 3. Data Privacy Guarantees

FocusGuard AI enforces a strict zero-PII data boundary:

| Data Element | Transmitted to LLM | Technical Safeguard |
| :--- | :--- | :--- |
| **Normalized Hostname** | **YES** (e.g., `"mathworks.com"`) | Minimum viable string for category inference |
| **Full URL / URL Path** | **NEVER SENT** | Stripped before transmission |
| **Query Parameters (`?q=`, `?token=`)** | **NEVER SENT** | Rejected by Pydantic validator with HTTP 422 |
| **Page Body / DOM / Form Data** | **NEVER SENT** | Extension has zero content scraping scripts |
| **Keystrokes / Mouse Data** | **NEVER SENT** | System agent discards all character identities |
| **User Identifiers / Cookies** | **NEVER SENT** | Stateless server; zero auth headers |
| **Browsing History** | **NEVER SENT** | One-off isolated domain queries |

---

## 4. Provider & Model Configuration

- **Provider**: Google Gemini REST API.
- **Default Model**: `gemini-3.5-flash-lite` (current supported official lightweight Gemini model).
- **Environment Variable**: `LLM_API_KEY` (read strictly server-side via `os.environ.get("LLM_API_KEY")` or local `.env`).
- **Security Invariant**: The API key is **never present in browser extension files**, manifest, or Git repositories.

---

## 5. Structured Prompt & Output Schema

### System Prompt:
```
You are an objective web domain classifier for FocusGuard AI.
Classify the general purpose of the given domain into exactly one category:
- "educational": Technical documentation, coding practice, e-learning platforms, academic portals, tutorials.
- "non_educational": Social media, entertainment streaming, gaming, general consumer shopping.
- "unknown": Mixed-content platforms (e.g. YouTube, Reddit, Google), multi-purpose platforms, search engines, or ambiguous websites.

Output strictly valid JSON with no markdown formatting:
{
  "category": "educational" | "non_educational" | "unknown",
  "confidence": <float between 0.0 and 1.0>
}
```

---

## 6. Confidence Rule & Threshold Enforcement

$$\text{LLM\_CONFIDENCE\_THRESHOLD} = 0.80$$

- $\text{category} = \text{educational} \land \text{confidence} \ge 0.80 \implies$ Accept **`educational`**.
- $\text{category} = \text{non\_educational} \land \text{confidence} \ge 0.80 \implies$ Accept **`non_educational`**.
- $\text{confidence} < 0.80 \lor \text{category} = \text{unknown} \implies$ Evaluate to **`unknown`**.

---

## 7. Mixed-Content Policy

> [!NOTE]
> **Domain-only classification cannot determine user intent on mixed-content websites.**
> Platforms like `youtube.com`, `reddit.com`, `google.com`, `medium.com`, and `wikipedia.org` are explicitly classified as **`"unknown"`** without invoking the LLM, because a single domain hosts both highly productive tutorials and non-productive entertainment.

---

## 8. Timeout & Graceful Failure Recovery

- **Timeout**: 3.0 seconds (`timeout_seconds = 3.0`).
- **Failure Modes**:
  - Missing API key $\rightarrow$ Safely returns `category: "unknown"`, `source: "missing_api_key"`.
  - Network timeout $\rightarrow$ Safely returns `category: "unknown"`, `source: "llm_timeout"`.
  - HTTP 500 / 429 rate limit $\rightarrow$ Safely returns `category: "unknown"`, `source: "llm_http_error"`.
  - Malformed LLM response $\rightarrow$ Safely returns `category: "unknown"`.
- **System Stability**: Telemetry, tab tracking, and active/idle math continue without interruption under all failure scenarios.

---

## 9. Verification & Test Matrix

The test suite in [`resolver-server/tests/test_llm_classifier.py`](file:///d:/infosys/focusguard-extension/resolver-server/tests/test_llm_classifier.py) executes all 20 mocked scenarios:
1. High-confidence educational classification ($\ge 0.80$).
2. High-confidence non-educational classification ($\ge 0.80$).
3. Unknown category classification.
4. Confidence threshold enforcement ($0.79 \rightarrow \text{unknown}$).
5. Boundary condition ($0.80 \rightarrow \text{accepted}$).
6. Invalid category string handling.
7. Invalid confidence format handling.
8. Malformed non-JSON response handling.
9. Network timeout handling (3.0s).
10. HTTP 500 / 429 error handling.
11. Missing API key handling.
12. `youtube.com` mixed-content bypass.
13. `google.com` mixed-content bypass.
14. `reddit.com` mixed-content bypass.
15. Static registry hit skips LLM.
16. Subdomain registry hit skips LLM.
17. Unlisted domain triggers LLM fallback.
18. Concurrent duplicate requests deduplication.
19. Payload normalization (hostname only).
20. Sensitive data rejection (paths/query parameters).
