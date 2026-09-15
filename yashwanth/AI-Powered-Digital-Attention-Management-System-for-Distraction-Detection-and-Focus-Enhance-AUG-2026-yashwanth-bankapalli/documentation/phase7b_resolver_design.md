# FocusGuard AI – Phase 7B Architectural Design Document
## Real Automatic Resolver for Unknown Domains

> **Status**: Proposed / Research & Design Phase (Phase 7B)  
> **Target System**: FocusGuard AI (Browser Extension + Backend Resolver Service)  
> **Author**: FocusGuard AI Engineering Team  

---

## 1. Problem Statement

In **Phase 7A**, FocusGuard AI implemented an asynchronous, non-blocking classification cache layer:
- **Tier 1 (Static Registry)**: Immediate lookup for known domains (`github.com`, `instagram.com`).
- **Tier 2 (Client Cache)**: Fast local cache in `chrome.storage.local` with a 30-day TTL and 2,000-entry capacity.
- **Tier 3 (Pluggable Resolver Interface)**: `registerDomainResolver(fn)` and `resolveUnknownDomainAsync(domain)`.

However, the actual **resolver function** is currently a stub interface. Unlisted websites (e.g. `leetcode.com`, `khanacademy.org`, `kaggle.com`, `twitch.tv`) remain persistently classified as `"unknown"` because no real automated classification engine is attached.

### The Objective of Phase 7B:
Design a secure, privacy-preserving, cost-effective, and offline-resilient **Automatic Resolver Engine** that classifies unlisted domains into:
- `"educational"`
- `"non_educational"`
- `"unknown"` (when confidence is insufficient or user intent is mixed)

---

## 2. Review of Current Phase 7A Architecture

```
Normalized Domain (e.g. leetcode.com)
            │
            ▼
┌──────────────────────────────┐
│ Tier 1: Static Registry      │
│ (DOMAIN_CATEGORIES)          │
└──────────────┬───────────────┘
               │
       Found in Registry?
        /              \
     YES                NO
     /                    \
┌──────────────────┐    ┌──────────────────────────────┐
│ Return Category  │    │ Tier 2: Storage Cache Lookup │
│  (Synchronous)   │    │ (chrome.storage.local)       │
└──────────────────┘    └──────────────┬───────────────┘
                                       │
                               Found & Non-Expired?
                                /              \
                             YES                NO
                             /                    \
                  ┌──────────────────┐    ┌──────────────────────────────┐
                  │ Return Cached    │    │ Fallback to "unknown" (Sync) │
                  │ Category         │    │ (Session starts immediately) │
                  └──────────────────┘    └──────────────┬───────────────┘
                                                         │
                                                         ▼
                                          ┌──────────────────────────────┐
                                          │ Tier 3: Async Resolver Queue │
                                          │ (Pluggable Background Job)   │
                                          └──────────────┬───────────────┘
                                                         │
                                                         ▼
                                          ┌──────────────────────────────┐
                                          │ [PHASE 7B REAL RESOLVER]     │
                                          └──────────────┬───────────────┘
                                                         │
                                                         ▼
                                          ┌──────────────────────────────┐
                                          │ Update Local Cache           │
                                          │ (30-day TTL, 2000 max items) │
                                          └──────────────────────────────┘
```

---

## 3. Why the Real Resolver is Needed

1. **Long-Tail Scaling**: Millions of technical documentation hubs (`docs.rs`, `developer.mozilla.org`, `numpy.org`), coding practice portals (`leetcode.com`, `codewars.com`, `hackerrank.com`), and educational portals cannot be manually maintained.
2. **Zero Inconvenience to User**: New websites are classified in the background without prompting the user or breaking browser performance.
3. **Continuous Learning**: Once resolved, results are cached locally for 30 days, avoiding redundant lookups.

---

## 4. Options Considered for Phase 7B Resolver

We evaluate five potential architectures:

### Option 1: Direct External Classification API from Browser Extension
- **Mechanism**: The extension background worker directly calls a 3rd-party API (e.g., Cloudflare Radar, Cisco Talos, Google Web Risk).
- **Security Vulnerability**: Requires embedding API secret keys directly into client-side extension code (`manifest.json` or `background.js`), exposing credentials to anyone who inspects the extension.
- **Evaluation**: **Unacceptable** due to key exposure and commercial API costs.

### Option 2: Custom Lightweight Python Backend Service (FastAPI)
- **Mechanism**: Extension calls a dedicated, self-hosted Python (FastAPI) microservice (`POST /classify-domain`). The backend uses local rule engines, curated datasets (e.g. OpenPageRank / Alexa top 1M educational/entertainment subsets), and TLD/DNS intelligence.
- **Pros**: Fast, zero cost, completely self-hosted, easy to explain and demonstrate to mentors, aligns with our Python ecosystem.
- **Cons**: Covers known datasets and pattern heuristics; may return `"unknown"` on extremely obscure domains.

### Option 3: Backend Proxy + Commercial LLM API (Gemini / OpenAI / Claude)
- **Mechanism**: Extension calls FocusGuard backend proxy; backend forwards the domain to an LLM with a strict JSON prompt asking for classification and confidence.
- **Pros**: Outstanding zero-shot comprehension of brand-new tech tools and niche websites.
- **Cons**: External API dependency, token cost, potential cold-start latency (300–800ms), rate limiting.

### Option 4: Backend + Open-Source Domain Intelligence / Curated Dataset
- **Mechanism**: Backend loads pre-compiled databases of 500k+ categorized domains (e.g. from open-source web filter lists like UT1, Shalla, or StevenBlack hosts) stored in SQLite/DuckDB.
- **Pros**: 100% deterministic, zero LLM cost, sub-10ms lookup speed on server.
- **Cons**: Database updates required periodically.

### Option 5: Tiered Hybrid Backend (FastAPI + Open Dataset + Optional LLM Fallback) - RECOMMENDED
- **Mechanism**:
  1. **Step 1 (Fast Deterministic Tier)**: Server checks high-speed dataset / heuristic rules (e.g. `.edu`, `.gov`, developer platforms).
  2. **Step 2 (LLM Fallback Tier - Optional)**: If unlisted and confidence $< 0.80$, server calls a low-cost LLM (e.g. Gemini 1.5 Flash) via secure server-side environment variables.
  3. **Step 3 (Safe Fallback)**: If confidence remains $< 0.80$ or network fails, strictly returns `"unknown"`.

---

## 5. Comprehensive Comparison Matrix

| Criteria | Option 1: Direct Client API | Option 2: Pure Custom Backend | Option 3: Pure Cloud LLM | Option 4: Pure Database Backend | Option 5: Tiered Hybrid Backend (Recommended) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Accuracy** | Moderate (Generic) | High | Very High | High | **Very High** |
| **Credential Security**| **CRITICAL FAIL (Leaked)** | Excellent (No keys) | Excellent (Server proxy) | Excellent (No keys) | **Excellent (Server-side ENV)** |
| **Privacy Preservation**| Low (Vendor sees domains) | Excellent (Own server) | High (Domain only) | Excellent (Own server) | **Strict (Domain string only)** |
| **Response Latency** | 200–500ms | 10–30ms | 300–800ms | 5–15ms | **15–50ms (Deterministic) / Async**|
| **Operational Cost** | High (Paid plan) | $0.00 (Self-hosted) | Low (~$0.0001/req) | $0.00 (SQLite) | **$0.00 (Free Tier / Serverless)** |
| **Complexity** | Low | Low | Moderate | Moderate | **Low–Moderate** |
| **Offline Resilience** | Safe Fallback | Safe Fallback | Safe Fallback | Safe Fallback | **100% Safe (Local Cache)** |
| **Suitability for Internship**| Unacceptable | Very Good | Good | Good | **Optimal (Industry Standard)** |

---

## 6. Recommended Architecture: Tiered Hybrid Backend Resolver

### Technology Choice: Python + FastAPI
We recommend **Python + FastAPI** for the FocusGuard backend:
1. **Consistency**: Matches our existing Python system-agent (`activity_tracker.py`, `session_activity.py`).
2. **Speed & Asynchrony**: Built on Starlette / `uvloop` with native asynchronous `async/await` request handling.
3. **Zero Complexity**: Single-file implementation (`resolver_server.py`) with automatic OpenAPI Swagger documentation.
4. **Mentorship Demonstrability**: Mentors can run `uvicorn resolver_server:app` locally on `localhost:8000` with zero configuration.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        User Browser Extension                          │
│                                                                        │
│   Active Session: leetcode.com                                         │
│   • Start Session immediately (Status: ACTIVE, Category: "unknown")    │
│   • Check In-Flight Pending Set (prevent duplicate network calls)      │
│   • Non-blocking fetch: POST http://127.0.0.1:8000/classify-domain     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP POST (Payload: {"domain": "leetcode.com"})
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               FocusGuard Backend Resolver (FastAPI)                    │
│                                                                        │
│   1. Domain Normalizer: Strip protocol, port, www.                     │
│   2. Server-side Fast-Tier: High-confidence heuristics & domain db     │
│   3. Confidence Evaluator:                                             │
│      • If Confidence >= 0.80 -> Return "educational" / "non_educational"│
│      • If Ambiguous (e.g. youtube.com) -> Return "unknown"             │
│      • If Unlisted -> Optional Server LLM / Rule Check                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ JSON Response: {"domain":"leetcode.com","category":"educational","confidence":0.95,"source":"server_rules"}
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Extension Callback Handler                        │
│                                                                        │
│   • Save to chrome.storage.local ('domain_classification_cache')       │
│   • Set 30-Day TTL                                                     │
│   • Next visit to leetcode.com resolves in 0ms directly from cache     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. API Request & Response Design

### Endpoint: `POST /classify-domain`

#### Headers:
```http
Content-Type: application/json
Accept: application/json
```

#### Request Payload:
```json
{
  "domain": "leetcode.com"
}
```

#### Successful Response (`200 OK`):
```json
{
  "domain": "leetcode.com",
  "category": "educational",
  "confidence": 0.95,
  "source": "server_domain_db"
}
```

#### Ambiguous / Mixed-Content Response (`200 OK`):
```json
{
  "domain": "youtube.com",
  "category": "unknown",
  "confidence": 0.50,
  "source": "mixed_content_policy"
}
```

#### Error / Unlisted Response (`200 OK` - Graceful Degradation):
```json
{
  "domain": "obscure-unclassified-site.xyz",
  "category": "unknown",
  "confidence": 0.00,
  "source": "unlisted_fallback"
}
```

---

## 8. Privacy Analysis: Zero-PII Egress

The outbound payload is strictly constrained:

| Data Type | Outbound Status | Technical Safeguard |
| :--- | :--- | :--- |
| **Domain Hostname** | **SENT** (e.g., `"leetcode.com"`) | Minimum viable identifier for classification |
| **Full URL / Path** | **NEVER SENT** | Stripped on client side (`getDomainFromUrl`) |
| **Query Parameters (`?v=`, `?q=`)** | **NEVER SENT** | Stripped before transmission |
| **Page Text / DOM / Form Data** | **NEVER SENT** | Extension has zero content scripts attached |
| **Keystrokes / Typed Text** | **NEVER SENT** | System agent discards all key identities |
| **User Identifiers / Cookies / Tokens** | **NEVER SENT** | Zero auth headers, zero cookies attached |
| **IP / User Tracking Profile** | **NEVER STORED** | Stateless server; logs discard IP addresses |

---

## 9. Security & API Key Protection

1. **Zero Secret Keys on Client**:
   - The browser extension contains **zero API keys** in `manifest.json`, `background.js`, `popup.js`, or storage.
   - Any external API credentials (e.g. `GEMINI_API_KEY` or `CLOUDFLARE_API_KEY`) reside exclusively in server-side `.env` files.
2. **CORS Hardening**:
   - Backend allows requests from `chrome-extension://*` or `localhost`.
3. **Payload Sanitization**:
   - Server validates domain string using strict regex (`^[a-z0-9.-]+\.[a-z]{2,}$`), rejecting malicious injections or oversized payloads.

---

## 10. Robustness, Concurrency & Network Lifecycle

### 10.1 Duplicate-Request Prevention (In-Flight Request Set)
If a user rapidly opens 5 tabs of `docs.python.org` while resolution is pending:
- `background.js` maintains `pendingDomainResolutions = new Set()`.
- The first tab triggers the `fetch()` request and adds `'docs.python.org'` to the Set.
- Subsequent tabs see the domain in `pendingDomainResolutions` and skip duplicate network requests.
- When the request completes, the domain is saved to cache and removed from the Set.

### 10.2 Timeout Strategy
- Network requests use `AbortController` with a **3.0-second timeout**.
- If the backend does not respond within 3 seconds, the promise aborts silently without throwing uncaught errors.

### 10.3 Failure & Offline Handling
- If the network fails, DNS fails, or server is offline (`ECONNREFUSED`):
  - Catch block returns `'unknown'`.
  - Extension continues tracking session start/end and active/idle time without interruption.
  - No error alerts or popups are displayed to the user.

---

## 11. Mixed-Content Platform Handling

Platforms like `youtube.com`, `reddit.com`, `google.com`, `wikipedia.org`, and `medium.com` present an inherent classification challenge:

1. **Defensible Principle**: A domain alone does not represent educational intent on mixed platforms. A user watching an MIT calculus lecture and a user watching entertainment shorts share the exact same domain (`youtube.com`).
2. **Phase 7B Policy**:
   - The resolver classifies `youtube.com`, `reddit.com`, `google.com` as **`"unknown"`** (`confidence: 0.50`).
   - This prevents false productive/distracted inflation.
3. **Future Extension (Phase 8+)**: Optional client-side video category metadata inspection (e.g. YouTube category tags like "Education" or "Science & Technology") without scraping user comments or personal search history.

---

## 12. Confidence Score Handling

1. **Thresholding Rule**:
   $$\text{Final Category} = \begin{cases} \text{Resolved Category}, & \text{if Confidence} \ge 0.80 \\ \text{"unknown"}, & \text{if Confidence} < 0.80 \end{cases}$$
2. **Confidence Sources**:
   - Direct database / TLD match (`.edu`, known developer platform): $\text{Confidence} = 1.00$.
   - Server pattern heuristic: $\text{Confidence} = 0.85$.
   - Ambiguous / unlisted domain: $\text{Confidence} < 0.80 \rightarrow \text{"unknown"}$.
3. **Honesty Rule**: If an external provider does not supply a numeric confidence score, the server maps confidence deterministically based on list authority (e.g., authoritative list = $0.95$, unverified heuristic = $0.60$).

---

## 13. Scalability & Operational Costs

- **Client Cache Absorption**: In Phase 7A, local `chrome.storage.local` cache holds 2,000 domains for 30 days. In practice, $> 98\%$ of daily domain requests hit the client cache directly, resulting in negligible server traffic.
- **Server Cost**: A single lightweight Python FastAPI instance on free-tier serverless (e.g. Render, Railway, or local) can handle $1,000+\text{ req/sec}$ with zero monthly cost.

---

## 14. Phase 7B Implementation Plan

When ready to implement Phase 7B, the following steps will be executed:

1. **Step 1: Backend Resolver Service (`backend/resolver_server.py`)**:
   - Implement FastAPI app with `POST /classify-domain`.
   - Embed high-confidence domain dictionary (programming, science, university TLDs, social media).
2. **Step 2: Extension Resolver Client Connector (`background.js`)**:
   - Implement `fetchDomainClassification(domain)` with `AbortController`, in-flight deduplication (`pendingDomainResolutions`), and `setCachedDomainCategory` persistence.
   - Register the client connector via `registerDomainResolver()`.
3. **Step 3: Automated Test Suite (`test_phase7b_resolver.js`)**:
   - Verify asynchronous resolution of unlisted domains (`leetcode.com` $\rightarrow$ `educational`).
   - Verify duplicate request suppression for concurrent tab opens.
   - Verify offline fallback behavior when backend server is offline.
   - Verify that all Phase 1–7A tests and Team 2 JSON output schemas pass without regression.

---

## 15. Recommendation

### **Recommended Approach: Option 5 (Tiered Hybrid with Python FastAPI Resolver)**

**Why this is the best choice for FocusGuard AI:**
1. **Student & Internship Aligned**: Fast to implement, clean to maintain, and 100% explainable during technical evaluations.
2. **Guaranteed Credential Security**: Zero API keys or secrets are exposed inside browser extension files.
3. **Strict Privacy**: Only normalized domain strings leave the client machine.
4. **Non-Blocking Architecture**: Browsing telemetry starts instantly at $t=0$; dynamic resolution runs silently in the background.
5. **Zero Breaking Changes**: Fully utilizes the Phase 7A cache, maintains the Team 2 JSON schema, and preserves all active/idle tracking logic.
