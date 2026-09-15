# FocusGuard AI – Manual End-to-End Testing & Demonstration Guide

> **Target Audience**: Students, Developers, and Project Mentors  
> **System Scope**: Full Multi-Tier Platform (Chrome Extension + FastAPI Resolver + Python System Agent)  
> **Status**: Verified for Phases 1–10  

---

## 1. Environment Setup & Prerequisites

### A. Load Chrome Browser Extension
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle **Developer mode** ON (top right switch).
3. Click **Load unpacked** (top left).
4. Select the project root directory: `d:\infosys\focusguard-extension`.
5. Verify that **FocusGuard AI** (v1.0.0) appears with `background.js` (Service worker active).
6. Click the Extensions puzzle icon in Chrome toolbar and **Pin** FocusGuard AI.

### B. Start Local FastAPI Resolver Server (Optional for Tier-3 LLM Testing)
```bash
cd resolver-server
python -m uvicorn resolver_server:app --host 127.0.0.1 --port 8000
```
- Verify health check: `http://127.0.0.1:8000/health` $\rightarrow$ `{"status":"ok"}`.

### C. Start Python System Agent (For Physical Presence & Idle Decomposition)
```bash
cd system-agent
python activity_tracker.py
```
- Listens to system-level mouse/keyboard events (without logging characters or coordinates).

---

## 2. Step-by-Step Manual Test Scenarios

### TEST 1 — Basic Domain Tracking
* **Action**:
  1. Open a new Chrome tab and navigate to `https://github.com`.
  2. Wait approximately 30 seconds while staying on GitHub.
  3. Click the FocusGuard AI extension icon in the toolbar.
* **Expected Outcome**:
  - Header Status: `Active` (Green dot).
  - CURRENT WEBSITE: `github.com`.
  - Session timer: $\approx$ `00:30` (ticking upward live).
  - Close the popup, wait 10 seconds, and reopen the popup.
  - **Verification**: The same session continues uninterrupted ($\approx$ `00:40`). No duplicate session is created.

---

### TEST 2 — Tab Switch Detection
* **Action**:
  1. Keep `github.com` open in Tab 1.
  2. Open Tab 2 and navigate to `https://www.youtube.com`.
  3. Open the FocusGuard popup.
* **Expected Outcome**:
  - The `github.com` session is finalized and logged in **RECENT ACTIVITY**.
  - Active domain updates to `youtube.com` with a fresh session timer (`00:01+`).
  - Expand **Recent switches** dropdown: shows `github.com → youtube.com`.
  - **This Hour Switches** counter increments by exactly **1**.

---

### TEST 3 — Same-Domain Navigation Continuity
* **Action**:
  1. While on `youtube.com`, click any video link (e.g. `youtube.com/watch?v=...`).
  2. Navigate to another video or the YouTube subscriptions page.
  3. Open the popup.
* **Expected Outcome**:
  - The current domain remains `youtube.com`.
  - Session timer continues without resetting.
  - **Switch count does NOT increment**; zero artificial switch events are generated.

---

### TEST 4 — In-Tab Domain Transition
* **Action**:
  1. In an existing active tab on `github.com`, type `https://www.google.com` into the URL bar and press Enter.
  2. Open the popup.
* **Expected Outcome**:
  - `github.com` session ends and archives to storage.
  - `google.com` starts as the active session.
  - Exactly one new switch event is recorded: `github.com → google.com`.

---

### TEST 5 — Multi-Tier Domain Classification
* **Action**:
  1. Visit known educational platforms: `github.com`, `leetcode.com`, `stackoverflow.com`.
  2. Visit non-educational platforms: `instagram.com`, `netflix.com`.
  3. Visit mixed-content platforms: `youtube.com`, `reddit.com`, `google.com`.
* **Expected Outcome**:
  - `github.com` / `leetcode.com` $\rightarrow$ Evaluated as **`educational`**.
  - `instagram.com` / `netflix.com` $\rightarrow$ Evaluated as **`non_educational`**.
  - `youtube.com` / `google.com` $\rightarrow$ Evaluated as **`unknown`** (policy prevents assuming user intent).

---

### TEST 6 — LLM Fallback for Unlisted Domains
* **Action**:
  1. Ensure FastAPI server is running (`127.0.0.1:8000`).
  2. Visit an unlisted niche domain (e.g. `https://learncpp.com`).
  3. Check Service Worker Console (`Inspect`).
* **Expected Outcome**:
  - **First Visit**: Cache miss $\rightarrow$ Async resolver query sent to FastAPI $\rightarrow$ LLM classifies $\rightarrow$ Stored in `chrome.storage.local`.
  - **Second Visit**: Resolved in **0ms** directly from `chrome.storage.local` cache without contacting backend or LLM.
  - **Security Check**: API key is never logged or transmitted to the client.

---

### TEST 7 — Daily Tracking Accumulator (Tracked Today)
* **Action**:
  1. Complete multiple sessions on different websites today.
  2. Check **Tracked today** stat in the popup footer.
* **Expected Outcome**:
  - `Tracked today` = $\sum(\text{Today's Completed Durations}) + \text{Current Active Duration}$.
  - Yesterday's sessions stored in history are safely excluded from today's total without deleting historical records.

---

### TEST 8 — Presence Tracking & Idle Math
* **Production Threshold**: 10 minutes (600 seconds) of zero mouse/keyboard activity.
* **Test Verification (Automated/Simulated)**:
  - When user stops input: `activity_tracker.py` marks state as `IDLE`.
  - When user moves mouse or types: state transitions to `ACTIVE`.
  - Invariant: $\text{Active Time} + \text{Idle Time} = \text{Total Session Duration}$.
  - Reading on `github.com` while idle is classified as `PRODUCTIVE` (`idle_state`), never distracted.

---

### TEST 9 — Hourly Window Switch Counting & Rollover
* **Action**:
  1. Check **THIS HOUR** card in popup: displays `HH:00–HH:00` (e.g. `14:00–15:00`).
  2. Perform several domain switches in the current hour.
* **Expected Outcome**:
  - Switch counter increments on every new domain.
  - When clock rolls over to the next hour (`15:00`), active counter resets to **0**, and previous hour is archived into `hourly_summaries`.

---

### TEST 10 — Distraction Detection (Rule-Based)
* **Action**:
  1. Perform $< 10$ switches in the current hour on educational/neutral domains.
  2. Perform $> 10$ switches in the current hour (e.g. 11+ switches).
* **Expected Outcome**:
  - Switches $< 10$ on `github.com` $\rightarrow$ Status: **`Productive`** (Green).
  - Switches $< 10$ on `instagram.com` $\rightarrow$ Status: **`Neutral`** (Yellow, brief visit is not distracted).
  - Switches $> 10$ $\rightarrow$ Status: **`Distracted`** (Red, reason: `high_switch_frequency`).

---

### TEST 11 — Notification Subsystem & 15-Min Cooldown
* **Action**:
  1. Trigger a state transition from `Productive` $\rightarrow$ `Distracted` (cross 10 switches).
  2. Immediately trigger an additional switch.
* **Expected Outcome**:
  - **First Transition**: Chrome notification appears:  
    `⚠️ FocusGuard AI: You may be getting distracted. Take a moment to refocus.`
  - **Subsequent Switches within 15 Minutes**: Notification is **suppressed by cooldown** (zero spam).

---

### TEST 12 — Popup Safety & State Isolation
* **Action**:
  1. While a session is actively running on any website, open and close the extension popup **5 consecutive times**.
* **Expected Outcome**:
  - Session timer does not reset.
  - Zero duplicate session records are saved.
  - Zero artificial domain switch events are created.

---

### TEST 13 — 5-Minute Mentor Demonstration Flow

```
[0:00 - 1:00] INTRO & ARCHITECTURE
- Open chrome://extensions, show FocusGuard AI pinned in Chrome.
- Explain 3-tier architecture: Extension -> Local FastAPI -> Server LLM fallback.

[1:00 - 2:00] LIVE SESSION & DOMAIN TRACKING
- Open github.com -> open popup -> show live timer and "Productive" status badge.
- Open documentation link on same domain -> show session timer continuity.

[2:00 - 3:30] SWITCH COUNTING & DISTRACTION DETECTION
- Switch between github.com, stackoverflow.com, and instagram.com.
- Show "Recent switches" list and "This Hour: Switches" counter.
- Explain false-positive prevention: brief Instagram visit is "Neutral", not automatically "Distracted".

[3:30 - 4:30] NOTIFICATION & PRIVACY GUARANTEES
- Show Chrome notification trigger on distraction threshold.
- Explain privacy invariants: Zero keystrokes, zero screenshots, domain-only boundary.

[4:30 - 5:00] TEAM 2 DATA SCHEMA & WRAP-UP
- Open Service Worker Console -> show compliant Team 2 JSON record.
```

---

### TEST 14 — Service Worker Console & Team 2 JSON Output Validation
* **Action**:
  1. Open `chrome://extensions`.
  2. Under FocusGuard AI, click **Service worker** (Inspect).
  3. In DevTools Console, view logged activity outputs.
* **Expected Format**:
```json
{
  "source": "extension",
  "name": "github.com",
  "start_time": "14:00",
  "end_time": "14:30",
  "duration": 1800,
  "category": "educational",
  "distraction_state": "productive"
}
```
* **Schema Invariant**: All 5 mandatory Team 2 fields (`source`, `name`, `start_time`, `end_time`, `duration`) are present with valid data types.

---

## 3. Privacy Boundary Demonstration

| Category | Specific Elements Captured | Technical Boundary & Protection |
| :--- | :--- | :--- |
| **Tracked Telemetry** | Normalized domain (`github.com`), start/end times (`14:00`), duration (`1800s`), hourly switch count (`3`), category (`educational`). | Stored strictly in local `chrome.storage.local`. |
| **NEVER Captured** | User passwords, form inputs, full URLs (`/user/repo`), search query strings (`?q=`), page HTML/DOM, screenshots, webcam, clipboard, keystrokes, mouse coordinates. | Extension has zero content scraping scripts; System agent discards all character identities. |

---

## 4. Manual Test Result Template Table

| Test # | Test Scenario Description | Expected Outcome | Actual Result | Status | Notes |
| :---: | :--- | :--- | :--- | :---: | :--- |
| **1** | Basic Domain Tracking (`github.com`) | Timer ticks live, persists on reopen | | | |
| **2** | Tab Switch (`github.com` $\rightarrow$ `youtube.com`) | Session finalized, switch recorded | | | |
| **3** | Same-Domain Navigation (`youtube.com/...`) | Timer continues, 0 switch events | | | |
| **4** | New Domain in Same Tab (`github` $\rightarrow$ `google`) | In-tab transition detected cleanly | | | |
| **5** | Domain Classification (Static Registry) | `github` (edu), `insta` (non-edu), `yt` (unknown) | | | |
| **6** | LLM Fallback (Unlisted Domain) | Resolved via Gemini, cached for 0ms next visit | | | |
| **7** | Daily Tracking Accumulator | Sum of today's sessions + active session | | | |
| **8** | Idle Detection & Time Decomposition | Active + Idle = Duration; Reading $\ne$ Distracted | | | |
| **9** | Hourly Switch Window ($HH:00–HH:00$) | Increments correctly, resets at rollover | | | |
| **10** | Distraction Detection Rule Engine | $<10$ focused, $===10$ boundary, $>10$ distracted | | | |
| **11** | Distraction Notification & Cooldown | Alerts on leading edge, 15-min cooldown active | | | |
| **12** | Popup Safety & Isolation | 5+ open/close cycles cause 0 side-effects | | | |
| **13** | 5-Minute Live Demonstration Flow | Seamless end-to-end user workflow | | | |
| **14** | Service Worker Console Team 2 Schema | 5 mandatory fields formatted correctly | | | |

---

## 5. Potential Mentor Questions & Concise Answers

1. **Q: Why are websites like YouTube and Reddit classified as `"unknown"`?**  
   *A*: *"Domain-only classification cannot determine user intent on mixed-content websites."* A user on YouTube could be watching an MIT calculus lecture or entertainment shorts. Classifying it as unknown prevents incorrect false positives.
2. **Q: Why doesn't visiting Instagram immediately trigger a distraction notification?**  
   *A*: Brief visits (e.g. 2 minutes with low switch frequency) are classified as **`NEUTRAL`**. Distraction requires sustained high-frequency context switching ($> 10$ switches/hour).
3. **Q: What happens if the user is reading documentation without moving the mouse for 15 minutes?**  
   *A*: Physical inactivity is an **`idle_state`**, not a distraction. If the active domain is educational, the user is classified as **`PRODUCTIVE`**.
4. **Q: How is the LLM API key secured?**  
   *A*: The API key resides exclusively on the server side in environment variables (`.env`). The browser extension has zero knowledge of the key and communicates only via the local `127.0.0.1:8000` FastAPI resolver.
