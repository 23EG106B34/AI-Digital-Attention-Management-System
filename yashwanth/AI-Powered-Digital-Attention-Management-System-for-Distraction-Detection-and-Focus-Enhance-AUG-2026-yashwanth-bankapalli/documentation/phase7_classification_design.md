# FocusGuard AI – Phase 7 Architectural Design Document
## Automatic Dynamic Classification for Unknown Domains

> **Status**: Proposed / Research & Design Phase  
> **Document Version**: 1.0.0  
> **Target System**: FocusGuard AI (Browser Extension + System Agent Telemetry)

---

## 1. Executive Summary & Problem Statement

In **Phase 6**, FocusGuard AI established a baseline categorization engine utilizing a curated static registry (`DOMAIN_CATEGORIES`) for high-confidence domains (e.g., `github.com` $\rightarrow$ `educational`, `instagram.com` $\rightarrow$ `non_educational`). Unlisted domains (and mixed platforms like `youtube.com`) default strictly to `unknown`.

### The Core Problem:
The World Wide Web contains over **350 million active top-level domains** and billions of web applications. Maintaining a hardcoded list of domains does not scale:
1. **Long-Tail Websites**: Niche documentation sites, internal university portals, coding problem archives, and specialized research blogs cannot all be pre-cataloged.
2. **Maintenance Overhead**: Static lists become obsolete as new platforms emerge or change ownership.
3. **Over-Generalization**: Monolithic platforms (e.g., `youtube.com`, `reddit.com`, `medium.com`) host both high-value educational content and extreme digital distractions.

The objective of **Phase 7** is to design a scalable, privacy-preserving, and offline-resilient architecture to dynamically classify unknown domains while strictly maintaining compatibility with existing Phase 1–6 telemetry and the Team 2 JSON specification.

---

## 2. Current Phase 6 Approach & Baseline

Currently, domain classification operates as a synchronous, deterministic registry lookup:

```
Domain Extracted (e.g., docs.github.com)
            ↓
Normalize Domain & Subdomains (github.com)
            ↓
Check DOMAIN_CATEGORIES Registry
      /                  \
   Match                No Match
    ↓                      ↓
"educational" /        "unknown"
"non_educational"
```

### Why Static Lists Alone Do Not Scale:
- **Registry Size vs. Browser Memory**: Embedding large blocklists/allowlists directly into `background.js` inflates memory footprint and extension installation size.
- **Binary Guessing Hazard**: Heuristic keyword rules (e.g., assuming any domain containing `"study"` or `"learn"` is educational) create severe false positives (e.g., phishing or marketing sites like `study-crypto-tricks.com`).
- **Zero Context on Ambiguous Platforms**: `youtube.com` contains MIT OpenCourseWare lectures alongside short-form entertainment; a purely static domain lookup cannot differentiate between them.

---

## 3. Options Considered for Unknown Domain Classification

We evaluate five architectural alternatives across technical, economic, and privacy dimensions:

### Option 1: External Domain Categorization / Web Reputation API
*(e.g., Cloudflare Radar Domain Categorization, Cisco Talos / Webroot API, Google Web Risk)*
- **Mechanism**: Browser extension queries a commercial DNS/web categorization API whenever an unlisted domain is visited.
- **Pros**: Millions of domains already classified with established taxonomy.
- **Cons**: Requires paid API subscriptions, introduces rate limits, exposes real-time domain browsing to third parties, requires constant internet connectivity, and lacks fine-grained "educational" differentiation (typically outputs generic categories like "Technology", "Social Networking", "Streaming").

### Option 2: Custom FocusGuard Backend Classification Service
*(e.g., Lightweight FastAPI / Node.js Microservice with Database)*
- **Mechanism**: Unlisted domains are asynchronously submitted to a dedicated FocusGuard backend service. The backend uses server-side heuristics, DNS TXT/whois data, and curated databases to classify domains and return results to clients.
- **Pros**: Complete control over taxonomy, centralized caching across all users, keeps API keys off client machines.
- **Cons**: Introduces server infrastructure costs, devOps maintenance, cold-start latency, and requires managing user-privacy compliance across network boundaries.

### Option 3: Cloud AI / LLM-Based Zero-Shot Classifier
*(e.g., Gemini 1.5 Flash / Claude 3.5 Haiku / OpenAI mini via backend proxy)*
- **Mechanism**: The backend passes the domain name, clean non-PII metadata, and brief platform description to a compact, fast LLM with a strict JSON schema prompt to classify into `{ educational, non_educational, unknown }` with a confidence score.
- **Pros**: Exceptional zero-shot reasoning on obscure domains, understands new tech platforms immediately, handles nuanced category boundaries.
- **Cons**: Token costs, network latency (200–800ms), requires an active backend proxy to safeguard API keys, failure mode during outages.

### Option 4: Local Offline Lightweight Classifier / Bloom Filter + Heuristics
*(e.g., Compact Trie / Bloom Filter of top 100k domains + offline rule engine)*
- **Mechanism**: Extension embeds a pre-compiled, compressed binary Bloom filter or Trie derived from open-source educational/entertainment datasets (e.g., Common Crawl / Tranco top list) packaged directly inside the extension.
- **Pros**: 100% offline, zero network latency (0ms), absolute privacy (zero data leaves machine), zero running costs.
- **Cons**: Binary size overhead (approx. 2–5MB), cannot classify brand-new uncataloged domains, static until extension update.

### Option 5: Tiered Hybrid Architecture (RECOMMENDED)
*(Local Fast-Path $\rightarrow$ Local Cache $\rightarrow$ Lightweight Asynchronous Resolver)*
- **Mechanism**:
  1. **Tier 1 (Fast-Path Registry)**: Check local high-confidence registry in memory (0ms).
  2. **Tier 2 (Client Cache)**: Check `chrome.storage.local` cache for previously resolved domains with TTL (0ms).
  3. **Tier 3 (Async Resolver Engine)**: If unknown, mark current session as `unknown` immediately without blocking; dispatch an asynchronous background classification job to a lightweight classifier/resolver. When resolved, update cache for subsequent sessions.

---

## 4. Comprehensive Comparison Matrix

| Evaluation Dimension | Option 1: External Web API | Option 2: Custom Backend | Option 3: Pure Cloud LLM | Option 4: Pure Local Offline | Option 5: Tiered Hybrid (Recommended) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Accuracy** | Moderate (Generic categories) | High (Domain-tailored) | Very High (Contextual) | Moderate (Top 100k only) | **Very High** (Multi-tiered) |
| **Scalability** | High (Vendor-managed) | High (Horizontally scalable) | High (Token limits) | Moderate (Static bundle) | **Extremely High** |
| **Implementation Complexity** | Low–Moderate | Moderate | Moderate | Moderate | **Low–Moderate** |
| **Operational Cost** | High (Subscription/req) | Low–Moderate (VPS/Serverless)| Low ($0.0001/domain) | **$0.00 (Zero Cost)** | **$0.00 to Negligible** |
| **Classification Latency** | 150–400ms | 100–250ms | 300–800ms | **< 1ms (Instant)** | **< 1ms (Cached) / Async** |
| **Privacy Preservation** | Low (Vendor sees browsing) | Moderate (Own server) | Moderate (Domain sent) | **Absolute (100% On-Device)** | **Excellent (Domain-Only)** |
| **Internet Dependency** | 100% Required | 100% Required | 100% Required | **None (100% Offline)** | **Graceful Offline Fallback** |
| **Maintenance Burden** | Low | Moderate | Low | Moderate (Periodic updates) | **Low** |
| **Suitability for Internship** | Poor (Requires paid keys)| Moderate | Moderate (Needs backend) | Good | **Optimal (Phased Demo)** |
| **Suitability for FocusGuard**| Poor | Moderate | High (with proxy) | Moderate | **Ideal Long-Term Fit** |

---

## 5. Privacy & Data Governance Analysis

Privacy is the central architectural pillar of FocusGuard AI.

### Strict Privacy Invariants:
1. **Zero Keystrokes / Typed Content**: Hardware event listeners in the system agent process zero text, characters, or passwords.
2. **Zero Screen / Window / Media Capture**: No DOM body scraping, no screenshots, no form field reading.
3. **Zero Query Parameter / Auth Token Transmission**: Even if URLs are processed internally, query parameters (`?v=`, `?token=`, `?auth=`) and hash fragments (`#access_token=`) are stripped via `sanitizeUrl()` before normalization.
4. **Exact Data Boundary**:
   - **On-Device Data**: Normalized domain (e.g., `github.com`), session timestamps, duration, active/idle seconds.
   - **Outbound Data (Only for unlisted domains in Tier 3)**: Sanitized hostname string *only* (e.g. `{"domain": "leetcode.com"}`). Never headers, never user IDs, never cookies, never browsing history chains.

---

## 6. Recommended Architecture: Tiered Hybrid Classifier

We recommend a **Tiered Hybrid Architecture** that combines instant on-device resolution with asynchronous background classification.

```
                                  Browsing Session Starts
                                             │
                                             ▼
                                  Extract Normalized Domain
                                 (e.g., "leetcode.com")
                                             │
                                             ▼
                              ┌──────────────────────────────┐
                              │ Tier 1: In-Memory Registry   │
                              │ (DOMAIN_CATEGORIES)          │
                              └──────────────┬───────────────┘
                                             │
                                     Found in Registry?
                                      /              \
                                   YES                NO
                                   /                    \
                        ┌──────────────────┐    ┌──────────────────────────────┐
                        │ Return Category  │    │ Tier 2: Local Storage Cache  │
                        │ (0ms Latency)    │    │ (chrome.storage.local)       │
                        └──────────────────┘    └──────────────┬───────────────┘
                                                               │
                                                       Found in Cache & Valid?
                                                        /              \
                                                     YES                NO
                                                     /                    \
                                          ┌──────────────────┐    ┌──────────────────────────────┐
                                          │ Return Cached    │    │ Tier 3: Async Resolver Engine│
                                          │ Category (0ms)   │    │ • Return "unknown" for now   │
                                          └──────────────────┘    │ • Queue background resolve   │
                                                                  └──────────────┬───────────────┘
                                                                                 │
                                                                       Asynchronous Resolution
                                                                                 │
                                                                                 ▼
                                                                  ┌──────────────────────────────┐
                                                                  │ Dynamic Classification       │
                                                                  │ (Local Rules / Server / LLM) │
                                                                  └──────────────┬───────────────┘
                                                                                 │
                                                                                 ▼
                                                                  ┌──────────────────────────────┐
                                                                  │ Save to Local Cache          │
                                                                  │ (TTL: 30 Days)               │
                                                                  └──────────────────────────────┘
```

---

## 7. Granular Answers to Core Research Questions

### Q1: What is the best approach for our project?
**Answer**: The **Tiered Hybrid Approach** (Option 5). It provides instant local evaluation (0ms latency), 100% offline resilience, and zero disruption to active sessions. Unlisted domains default safely to `unknown` on first visit while being asynchronously classified and cached for all subsequent visits.

### Q2: Should classification happen inside the extension, the Python agent, a backend, or an external API?
**Answer**:
- **Extension Level**: Tier 1 (Registry) and Tier 2 (Cache) MUST live inside the extension (`background.js`) to provide zero-latency access during session initialization.
- **Python Agent Level**: Operates purely on user presence (active vs. idle time) and session time decomposition; it should remain decoupled from network HTTP classification calls.
- **Backend / Async Resolver Level**: Tier 3 dynamic classification should execute asynchronously via a lightweight resolver module (either local heuristics + metadata or a lightweight serverless backend proxy) to keep client-side extensions fast and lightweight.

### Q3: Should we classify by domain only, domain + path, page title, or metadata?
**Answer**:
- **Standard Websites**: Classify by **Normalized Domain** (e.g., `leetcode.com` $\rightarrow$ `educational`). Domain-level classification is lightweight, cacheable, highly reliable, and eliminates privacy risks.
- **Mixed-Content Platforms (e.g. YouTube)**: Classify by **Domain + Top-level Category / Sanitized Path / Non-sensitive Channel Meta**. For instance, `youtube.com/playlist?list=...` can be evaluated using public video category tags without scraping user comments or private videos.
- **Sensitive Context**: Never inspect page bodies, form inputs, or search query parameters.

### Q4: How do we handle mixed-content domains (`youtube.com`, `reddit.com`, `google.com`)?
**Answer**:
1. **Conservative Default**: Mixed domains remain strictly `'unknown'` at the domain registry level.
2. **Defensible Principle**: A website cannot be declared uniformly educational or non-educational if user intent varies wildly.
3. **Future Extension**: Sub-classification based strictly on sanitized public channel or playlist metadata, or user-configurable domain overriding (e.g. user tags a specific playlist as study material).

### Q5: How do we handle unknown domains?
**Answer**:
- Never guess based on superficial substring patterns (`study-crypto.com` is NOT automatically educational).
- Default to `"unknown"`.
- Asynchronously dispatch classification requests. If confidence is below threshold ($< 80\%$), the domain remains persistently `"unknown"`.

### Q6: How do we cache classifications?
**Answer**:
- **Storage Layer**: `chrome.storage.local` under the key `domain_classification_cache`.
- **Cache Record Schema**:
  ```json
  {
    "domain": "leetcode.com",
    "category": "educational",
    "confidence": 0.95,
    "source": "dynamic_classifier",
    "timestamp": 1788285000000,
    "ttl_seconds": 2592000
  }
  ```
- **TTL (Time-To-Live)**: 30 days ($2,592,000$ seconds).
- **Eviction / Invalidation Policy**: Least Recently Used (LRU) capped at 2,000 cached domains; manual cache purge option in extension settings.

### Q7: What happens when the internet is unavailable?
**Answer**:
- **100% Graceful Degradation**:
  - Tier 1 static registry continues to function instantly.
  - Tier 2 local cache continues to function instantly.
  - Any previously unseen unlisted domain remains classified as `"unknown"`.
  - Zero crashes, zero network error popups, and zero session tracking interruptions.

### Q8: What data leaves the user's computer?
**Answer**:
- **Zero data** leaves the computer for known or cached domains.
- For newly encountered unlisted domains in Tier 3: **Only the sanitized hostname string** (e.g., `{"domain": "docs.rs"}`) is sent.
- **NEVER sent**: URLs with query parameters, page content, cookies, session tokens, keystrokes, mouse positions, IP addresses, or user identifiers.

### Q9: What is the simplest approach we can realistically demonstrate to our mentor?
**Answer**:
Demonstrate a **3-Step Resolver Pipeline**:
1. **Show Registry Match**: Visit `github.com` $\rightarrow$ instant `educational` (Tier 1).
2. **Show Unknown Fallback**: Visit a completely new domain `randomtestsite.org` $\rightarrow$ `unknown` (Tier 2/3 fallback).
3. **Show Dynamic Resolution & Caching**: Simulate resolving `khanacademy.org` dynamically, writing to `chrome.storage.local` cache, and demonstrating that subsequent visits classify as `educational` in 0ms with cache validation.

### Q10: What approach can later be upgraded without rewriting Phase 1–6?
**Answer**:
The proposed Tiered Hybrid approach requires **zero schema changes** to Phase 1–6:
- Output records maintain all 5 required Team 2 fields: `source`, `name`, `start_time`, `end_time`, `duration`.
- The `category` field simply resolves from `classifyDomain(domain)` which seamlessly calls the cache/registry pipeline.
- Active/idle duration calculations from Phase 4 & 5 remain completely untouched.

---

## 8. Step-by-Step Implementation Roadmap for Phase 7

When moving from design to implementation in Phase 7, the recommended sequence is:

1. **Step 7.1: Client-Side Cache Layer (`domain_cache.js`)**:
   - Implement `getCachedCategory(domain)` and `setCachedCategory(domain, category, ttl)` using `chrome.storage.local`.
2. **Step 7.2: Hybrid Classifier Coordinator (`classifier.js`)**:
   - Wrap `DOMAIN_CATEGORIES` (Tier 1) and cache lookup (Tier 2) into a unified asynchronous `classifyDomainAsync(domain)` function.
3. **Step 7.3: Offline Heuristic & Rule Engine (Tier 3 Local Resolver)**:
   - Provide high-confidence TLD/SLD domain classifications (e.g., `.edu`, `.ac.uk`, `.gov` $\rightarrow$ `educational`) and known developer platforms.
4. **Step 7.4: Optional Lightweight Backend Resolver Proxy**:
   - If online LLM/database verification is desired, expose a single stateless endpoint `POST /classify-domain` accepting `{ domain: string }` and returning `{ domain, category, confidence }`.
5. **Step 7.5: Automated Verification Suite**:
   - Build unit tests verifying Tier 1 registry hits, Tier 2 cache hits, Tier 3 fallback to unknown, TTL expiration, and offline resilience.

---

## 9. Final Conclusion & Recommendation

For **FocusGuard AI**, the **Tiered Hybrid Architecture (Option 5)** provides the ideal balance between academic rigor, industrial software standards, user privacy, and implementation feasibility:

- **100% Preserves Existing Code**: Leaves Phase 1–6 telemetry, switch tracking, and active/idle math completely intact.
- **Zero Cost & Instant Speed**: 95%+ of typical browsing traffic resolves from memory/cache in $< 1\text{ms}$.
- **Uncompromised Privacy**: No sensitive URLs, contents, or user data ever leave the client machine.
- **Mentorship & Demonstration Ready**: Enables a clean, impressive demonstration showing immediate classification, cache persistence, and robust unknown-domain handling.
