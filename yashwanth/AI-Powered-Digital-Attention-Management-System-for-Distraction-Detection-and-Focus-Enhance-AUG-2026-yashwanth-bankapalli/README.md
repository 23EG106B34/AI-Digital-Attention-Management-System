# FocusGuard AI – Human Attention Preservation & Digital Distraction Intelligence Platform

> **Milestone 1 — Complete Implementation & Architecture Reference**  
> Built with Chrome Extension Manifest V3, Pure Vanilla JavaScript, FastAPI Microservice, and Gemini LLM.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Key Features](#2-key-features)
3. [Multi-Tier System Architecture](#3-multi-tier-system-architecture)
4. [Folder Structure](#4-folder-structure)
5. [Browser Extension Setup](#5-browser-extension-setup)
6. [Resolver Server Setup (FastAPI & Gemini LLM)](#6-resolver-server-setup-fastapi--gemini-llm)
7. [Domain Tracking & Normalization](#7-domain-tracking--normalization)
8. [Session Lifecycle & State Machine](#8-session-lifecycle--state-machine)
9. [Domain Switch Tracking (1-Hour Window)](#9-domain-switch-tracking-1-hour-window)
10. [Multi-Tier Domain Classification](#10-multi-tier-domain-classification)
11. [Dynamic Classification Cache](#11-dynamic-classification-cache)
12. [Gemini LLM Intelligent Fallback](#12-gemini-llm-intelligent-fallback)
13. [Active / Idle Presence Handling](#13-active--idle-presence-handling)
14. [Sleep & Lock Protection](#14-sleep--lock-protection)
15. [Distraction Detection Engine](#15-distraction-detection-engine)
16. [Team 2 JSON Output Standard](#16-team-2-json-output-standard)
17. [Privacy & Security Approach](#17-privacy--security-approach)
18. [Automated Testing Guide](#18-automated-testing-guide)
19. [Known Limitations & Milestone 2 Roadmap](#19-known-limitations--milestone-2-roadmap)

---

## 1. Project Overview

**FocusGuard AI** is an intelligent digital attention management platform designed to monitor digital distraction, track context switching, quantify productivity, and encourage deep focus.

As the **Extension Team (Team 2)**, our component operates as the front-line telemetry and intelligence layer inside the user's browser (Chrome/Edge). It reliably tracks web sessions, distinguishes active browsing from idle/sleep states, evaluates domain productivity, detects high-frequency context switching, and outputs structured activity records.

---

## 2. Key Features

- **Privacy-First Telemetry**: Zero keystrokes, zero coordinates, zero screenshots, zero URL query parameters, zero history scraping.
- **Atomic Session Management**: Tracks per-domain browsing duration with tab-switch and navigation continuity.
- **Hourly Context-Switch Counter**: Tracks genuine domain switches in rolling 1-hour windows (e.g. `09:00–10:00`).
- **4-Tier Classification Architecture**:
  1. *Tier 1*: In-memory curated static registry (`0ms`).
  2. *Tier 2*: Local persistent LRU classification cache (`chrome.storage.local`, 30-day TTL).
  3. *Tier 3*: Local FastAPI deterministic knowledge-base resolver (`http://127.0.0.1:8000`).
  4. *Tier 4*: Google Gemini LLM fallback with strict temperature & schema validation.
- **Sleep & Screen Lock Safeguards**: Uses `chrome.idle` and heartbeat gap analysis to strictly exclude Windows sleep/suspend time from session duration.
- **Multi-Signal Distraction Evaluation**: Distinguishes Productive, Neutral, and Distracted states based on domain categories and hourly switch volume.
- **Live Dark-Mode Popup Dashboard**: Real-time timer, focus status badge, hourly metrics, and recent activity feed.

---

## 3. Multi-Tier System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        User Web Browser (Chrome/Edge)                  │
│                                                                        │
│   Tab 1: GitHub           Tab 2: LeetCode          Tab 3: YouTube      │
└─────────┬────────────────────────┬────────────────────────┬────────────┘
          │                        │                        │
          ▼                        ▼                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│              Background Service Worker (background.js)                 │
│                                                                        │
│   • chrome.tabs / windows / idle event listeners                       │
│   • URL Normalization & Privacy Sanitizer                              │
│   • Session State Machine & Sleep/Lock Safeguards                      │
│   • Hourly Switch Window Accumulator                                   │
│   • Tier 1: Static Curated Registry Lookup                             │
│   • Tier 2: Persistent Storage Cache (30-day TTL)                      │
│   • Distraction Evaluation Engine                                      │
└──────────────────┬──────────────────────────────────┬──────────────────┘
                   │                                  │
      (Asynchronous HTTP POST)                        ▼
                   │             ┌───────────────────────────────────────┐
                   ▼             │  Local Storage (chrome.storage.local) │
┌──────────────────────────────────────┐ ├───────────────────────────────────────┤
│    FastAPI Resolver (Port 8000)      │ │  • Active session state               │
│                                      │ │  • Completed session history (FIFO)   │
│  • Tier 3: Local Knowledge-base DB   │ │  • Hourly switch counts & summaries   │
│  • Tier 4: Gemini LLM Fallback       │ │  • 30-Day Classification Cache        │
│    (Structured JSON, T=0.0, >= 0.80) │ └──────────────────┬────────────────────┘
└──────────────────────────────────────┘                    │
                                                            ▼
                                         ┌───────────────────────────────────────┐
                                         │       Popup UI Dashboard (popup.js)   │
                                         │                                       │
                                         │  • Live session timer                 │
                                         │  • Hourly switch count & focus status │
                                         │  • Tracked Today accumulation         │
                                         │  • Recent activity history table      │
                                         └───────────────────────────────────────┘
```

---

## 4. Folder Structure

```
focusguard-extension/
│
├── manifest.json              # Chrome Extension Manifest V3 metadata & permissions
├── background.js              # Background Service Worker (Session & Classification Engine)
├── popup.html                 # Extension Popup UI Markup
├── popup.js                   # Popup Controller, Live Timer & Storage Synchronizer
├── popup.css                  # Modern Glassmorphic Dark-Mode Stylesheet
├── icons/                     # Extension Action Icons (16x16, 48x48, 128x128)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
├── resolver-server/           # Local Python Classification Microservice
│   ├── resolver_server.py     # FastAPI Service & Domain Database
│   ├── llm_classifier.py      # Google Gemini 1.5/2.0 Flash Classifier Connector
│   ├── requirements.txt       # Python dependencies (fastapi, uvicorn, google-genai)
│   ├── .env.example           # Configuration template (GEMINI_API_KEY)
│   └── tests/                 # Resolver unit & integration test suites
│       ├── test_resolver_server.py
│       └── test_llm_classifier.py
│
├── system-agent/              # System Team Presence Tracker (Reference / Shared)
│   ├── activity_tracker.py    # System-level keyboard/mouse presence monitor
│   ├── session_activity.py    # Active/idle duration calculator
│   ├── requirements.txt       # System-level dependencies (pynput)
│   ├── test_activity_tracker.py
│   └── test_session_activity.py
│
├── documentation/             # Project Design Documentation & Manual Guides
│   ├── manual_testing_guide.md
│   ├── phase7_classification_design.md
│   ├── phase7b_resolver_design.md
│   ├── phase8_distraction_design.md
│   ├── phase9_notification_design.md
│   └── phase10_llm_classifier.md
│
├── .gitignore                 # Secrets, logs, cache, and OS ignore rules
└── README.md                  # Milestone 1 Master Reference Guide
```

---

## 5. Browser Extension Setup

1. Open **Google Chrome** or **Microsoft Edge**.
2. Navigate to `chrome://extensions` (or `edge://extensions`).
3. Toggle **Developer mode** (top-right switch) to **ON**.
4. Click **Load unpacked** (top-left button).
5. Select the project directory: `D:\infosys\focusguard-extension`.
6. Verify **FocusGuard AI** (v1.0.0) appears in your extensions list.
7. Click the Extensions (puzzle piece) icon in the browser toolbar and **Pin** FocusGuard AI.

---

## 6. Resolver Server Setup (FastAPI & Gemini LLM)

The Resolver Server provides optional Tier-3 local database lookups and Tier-4 Gemini LLM classification for unlisted domains.

### 1. Install Python Dependencies:
```bash
cd resolver-server
pip install -r requirements.txt
```

### 2. Configure Environment (Optional for Gemini LLM):
```bash
cp .env.example .env
```
Edit `.env` and set your Gemini API key:
```env
GEMINI_API_KEY=your_google_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-flash
```

### 3. Start the Server:
```bash
python resolver_server.py
```
- The service runs at `http://127.0.0.1:8000`.
- Swagger interactive documentation is accessible at `http://127.0.0.1:8000/docs`.

---

## 7. Domain Tracking & Normalization

FocusGuard AI safely extracts normalized web domains while ignoring internal browser pages:

1. **Protocol Filtering**: Only `http:` and `https:` traffic is tracked. Internal schemes (`chrome://`, `edge://`, `about:blank`, extension pages) are completely ignored.
2. **Domain Normalization**: Strips `www.` prefixes and converts hostnames to lowercase (e.g., `https://www.GitHub.com/repo` $\to$ `github.com`).
3. **URL Sanitization**: Strips sensitive URL paths, tokens, and query strings.

---

## 8. Session Lifecycle & State Machine

Sessions are managed with strict concurrency locks (`withSessionLock`) to prevent race conditions during rapid tab switching:

- **Session Start**: Initiated on `chrome.tabs.onActivated` or `chrome.tabs.onUpdated` when navigating to a new web domain.
- **Session Continuity**:
  - In-tab navigation within the same domain (e.g. `github.com/a` $\to$ `github.com/b`) preserves the ongoing session without resetting the timer.
  - Opening the extension popup or context menus does not terminate the active session.
- **Session Finalization**: Triggered when switching to a different domain or closing the tab. Emits a standard **Team 2 Activity Record**.

---

## 9. Domain Switch Tracking (1-Hour Window)

A domain switch occurs whenever the user moves between two different normalized domains (e.g. `github.com` $\to$ `youtube.com`).

- **Fixed 1-Hour Windows**: Grouped into clock hours (e.g., `09:00–10:00`, `10:00–11:00`).
- **Hourly Rollover**: When a new hour begins, the switch count automatically resets to 0, and the previous hour summary is archived into local history.
- **Threshold Rules**:
  - $< 10$ switches / hour $\to$ **Productive / Neutral**
  - $= 10$ switches / hour $\to$ **Neutral Boundary**
  - $> 10$ switches / hour $\to$ **Distracted**

---

## 10. Multi-Tier Domain Classification

Domains are categorized into three standardized buckets:
- **`educational`**: Technical platforms, documentation, online learning (`github.com`, `stackoverflow.com`, `coursera.org`, `udemy.com`, `leetcode.com`).
- **`non_educational`**: Social media, video entertainment (`instagram.com`, `netflix.com`).
- **`unknown`**: Mixed-content platforms (`youtube.com`, `reddit.com`, `google.com`) or unclassified domains.

### 4-Tier Resolution Architecture:
1. **Tier 1 — Static Registry**: Instant in-memory lookup (`0ms`).
2. **Tier 2 — Storage Cache**: Persistent local cache lookup (`0ms`).
3. **Tier 3 — Resolver Backend**: Local FastAPI query with 3-second non-blocking timeout.
4. **Tier 4 — Gemini LLM**: AI categorization with structured output, zero-temperature determinism, and $\ge 0.80$ confidence enforcement.

---

## 11. Dynamic Classification Cache

- **Storage Location**: `chrome.storage.local['domain_classification_cache']`.
- **Capacity**: Bounded at **2,000 entries** with FIFO eviction.
- **TTL**: **30 Days** (2,592,000,000 ms). Expired entries are automatically purged on startup.

---

## 12. Gemini LLM Intelligent Fallback

When an unlisted domain is encountered:
1. The resolver constructs a strict few-shot prompt with schema constraints.
2. Queries Google Gemini (`gemini-1.5-flash` or `gemini-2.0-flash`).
3. Enforces response format `{"category": "...", "confidence": 0.XX, "reason": "..."}`.
4. If confidence $< 0.80$ or API fails, safely defaults to `"unknown"`.

---

## 13. Active / Idle Presence Handling

- Listens to `chrome.idle.onStateChanged` transitions (`"active"`, `"idle"`, `"locked"`).
- When the user is inactive or locks the screen, active time accumulation is paused.
- When the user resumes activity, tracking restarts from the new timestamp without counting idle time.

---

## 14. Sleep & Lock Protection

To prevent Windows laptop sleep or suspend time from inflating browsing durations:

1. **Heartbeat Gap Detection**: If a time gap $> 60\text{s}$ occurs between active events (such as closing the laptop lid for hours), the sleep gap is detected and **excluded** from the browsing duration.
2. **True Active Arithmetic**:
   $$\text{Session Duration} = \text{Active Time Pre-Sleep} + \text{Active Time Post-Sleep}$$
3. **Popup Timer Clamping**: The live client-side timer clamps out sleep intervals and displays the accurate elapsed active duration.

---

## 15. Distraction Detection Engine

Evaluates productivity based on multiple concurrent signals:
- **High-Frequency Switching**: $> 10$ switches in 1 hour triggers `distracted`.
- **Single-Signal Protection**: Visiting a non-educational site alone with low switch count is marked `neutral` (not automatically distracted).
- **Idle State Protection**: Being idle on an educational domain remains `productive`.

---

## 16. Team 2 JSON Output Standard

Every completed session outputs a schema-compliant Activity Record containing the 5 mandatory Team 2 fields:

```json
{
  "source": "extension",
  "name": "github.com",
  "start_time": "10:00",
  "end_time": "10:25",
  "duration": 1500,
  "category": "educational",
  "distraction_state": "productive",
  "hostname": "github.com",
  "tab_id": 1,
  "url": "https://github.com/microsoft/vscode",
  "timestamp": "2026-09-02T10:00:00.000Z",
  "id": "fg_1788327919335_og3uilu",
  "domain": "github.com",
  "startTime": "2026-09-02T10:00:00.000Z",
  "endTime": "2026-09-02T10:25:00.000Z",
  "durationSeconds": 1500
}
```

---

## 17. Privacy & Security Approach

- **Zero Credentials on Client**: Zero API keys are stored in extension JavaScript files.
- **Zero Content Scraping**: Page body, typed text, passwords, and form entries are never accessed.
- **Zero Coordinates**: Mouse movement coordinates ($X, Y$) are discarded.
- **Localhost Only**: The resolver service binds strictly to loopback `127.0.0.1`.

---

## 18. Testing & Verification Guide

Milestone 1 extension capabilities (event dispatching, session lifecycle, hourly switch tracking, classification caching, sleep/idle protection, and distraction evaluation) were verified and validated across automated test suites and live browser testing during development.

### Backend & System Unit Test Suite:
```bash
pytest system-agent/ resolver-server/
```

### Manual Extension Verification:
Refer to [`documentation/manual_testing_guide.md`](documentation/manual_testing_guide.md) for step-by-step procedures to verify session tracking, popup UI live counters, switch tracking, and domain classification in Google Chrome and Microsoft Edge.

---

## 19. Known Limitations & Milestone 2 Roadmap

1. **Desktop Notifications**: While the notification logic, transition detector, and 15-minute cooldown pass all automated unit tests, desktop notification visual popups exhibited inconsistent behavior across certain Windows desktop configurations during manual testing. **Notification refinement is deferred to the next milestone.**
2. **Sub-Domain Granularity**: Subdomains (e.g. `docs.github.com`) inherit parent domain classifications unless explicitly overridden in cache.
3. **Advanced Tab Grouping**: Cross-window tab dragging and Chrome Tab Groups are scheduled for Milestone 2.
