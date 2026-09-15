# FocusGuard AI – Phase 8 Architectural Design Document
## Rule-Based Distraction Detection Engine

> **Status**: Implemented & Verified (Phase 8)  
> **Target System**: FocusGuard AI (Browser Extension + System Agent Integration)  
> **Author**: FocusGuard AI Engineering Team  

---

## 1. Problem Statement & Objective

In **Phases 1–7**, FocusGuard AI established:
- High-fidelity tab and domain session tracking.
- Hourly domain switch counting (`09:00-10:00`, `10:00-11:00`).
- System-level presence tracking (Active vs. Idle intervals).
- Tiered domain categorization (`educational`, `non_educational`, `unknown`).

The objective of **Phase 8** is to synthesize these independent signals into an explainable, rule-based **Distraction Detection System** that determines whether current computer usage is:
- **`PRODUCTIVE`**
- **`NEUTRAL`**
- **`DISTRACTED`**

---

## 2. Core Design Invariants

1. **Non-Educational $\ne$ Distracted**: Brief visits to non-educational sites (e.g. 2 minutes on `instagram.com`) are not automatically flagged as distraction.
2. **Idle $\ne$ Distracted**: When a user stops moving the mouse or typing (e.g. reading a book, paper, or complex documentation on `github.com`), they are in an **idle presence state**, not a distracted state.
3. **No AI/ML/LLM in Phase 8**: Pure, deterministic, human-explainable heuristic rules.
4. **Zero-PII Egress**: Operates strictly on domain category, switch frequency, and presence time. No screenshots, keystrokes, page body text, or search queries are ever inspected.

---

## 3. Input Signals

| Signal | Source | Role in Distraction Detection |
| :--- | :--- | :--- |
| **Current Domain** | Browser Extension | Hostname identifier (`github.com`, `instagram.com`). |
| **Domain Category** | Phase 6/7 Hybrid Engine | Categorization (`educational`, `non_educational`, `unknown`). |
| **Hourly Switch Count** | Background Worker | Frequency of tab transitions in current 1-hour window. |
| **Active / Idle State** | Phase 4/5 System Agent | Physical user interaction with mouse/keyboard. |
| **Session Duration** | Extension & System Agent | Elapsed seconds on current domain. |

---

## 4. Distraction Decision Flow & Rules

```
                      Context Input (domain, category, switch_count, is_idle)
                                                │
                                                ▼
                                    Switch Count > 10?
                                     /              \
                                  YES                NO
                                  /                    \
                     ┌────────────────────────┐         ▼
                     │ State: DISTRACTED      │    Switch Count === 10?
                     │ Reason:                │     /              \
                     │ high_switch_frequency  │   YES                NO
                     └────────────────────────┘   /                    \
                                       ┌───────────────────────┐        ▼
                                       │ State: NEUTRAL        │   Check Domain Category
                                       │ Reason:               │   (Low Switches < 10)
                                       │ threshold_boundary    │        │
                                       └───────────────────────┘        ▼
                                                       ┌─────────────────────────────────┐
                                                       │ • educational -> PRODUCTIVE     │
                                                       │   (educational_stable / idle)   │
                                                       │ • non_educational -> NEUTRAL    │
                                                       │   (non_educational_usage)       │
                                                       │ • unknown -> NEUTRAL            │
                                                       │   (unknown_domain)              │
                                                       └─────────────────────────────────┘
```

### Prototype Thresholds & Evidence:
- **Switch Threshold**: Prototype baseline = **10 switches per hour**.
  - `switch_count < 10`: Normal, focused switching or brief visits.
  - `switch_count === 10`: Prototype boundary (evaluated as `neutral`).
  - `switch_count > 10`: High-frequency context switching (evaluated as `distracted`).

---

## 5. Decision Output Schema

The `calculateDistractionState()` function produces an explainable structured result:

```json
{
  "state": "productive",
  "reason": "educational_stable",
  "switch_count": 3
}
```

### Reason Codes:
- `educational_stable`: User is actively working on an educational platform with focused, low switching.
- `idle_state`: User is idle on an educational/work platform (e.g. reading or thinking).
- `non_educational_usage`: Brief visit to a non-educational platform without excessive switching.
- `unknown_domain`: Mixed-content or unclassified domain with low switching.
- `high_switch_frequency`: User has exceeded 10 domain switches in the current 1-hour window.
- `threshold_boundary`: User is at the exact prototype boundary of 10 switches.

---

## 6. Concrete Examples & Scenarios

| Scenario | Domain | Category | Switch Count | State | Reason |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Focused Coding** | `github.com` | educational | 3 | **`PRODUCTIVE`** | `educational_stable` |
| **2. Brief Social Check** | `instagram.com` | non_educational | 2 | **`NEUTRAL`** | `non_educational_usage` |
| **3. High Tab Hopping** | `github.com` | educational | 15 | **`DISTRACTED`** | `high_switch_frequency` |
| **4. Mixed Video Platform**| `youtube.com` | unknown | 3 | **`NEUTRAL`** | `unknown_domain` |
| **5. Deep Reading / Idle** | `github.com` | educational | 2 (Idle 15m) | **`PRODUCTIVE`** | `idle_state` |
| **6. Distracted Surfing** | `instagram.com` | non_educational | 12 | **`DISTRACTED`** | `high_switch_frequency` |
| **7. Multi-Tab Dev Work** | `mdn.io` | educational | 4 | **`PRODUCTIVE`** | `educational_stable` |

---

## 7. Hourly Window Rollover & Lifecycle

1. At the top of the hour (`10:00`, `11:00`, etc.), `syncHourlyState()` executes:
   - The completed hour's summary (e.g. `09:00-10:00`, `switch_count: 14`, `classification: distracted`) is pushed to `hourly_summaries`.
   - The active `switch_count` resets to **`0`**.
   - The new hour begins in a **`PRODUCTIVE`** state.
2. Historical sessions and switch events are retained in their respective FIFO circular buffers.

---

## 8. Foundation for Phase 9 Smart Notifications

To prevent spamming the user when they remain in a distracted state:
- FocusGuard AI tracks state transitions:
  $$\text{PRODUCTIVE / NEUTRAL} \longrightarrow \text{DISTRACTED}$$
- The transition detector `checkDistractionTransition(newState)` returns `true` **only on the initial leading edge** of a distraction event.
- Phase 9 can hook into this edge transition to trigger a single, respectful notification.

---

## 9. Compatibility with Team 2 JSON Format

All 5 mandatory Team 2 fields remain completely unchanged:

```json
{
  "source": "extension",
  "name": "instagram.com",
  "start_time": "14:00",
  "end_time": "14:20",
  "duration": 1200,
  "category": "non_educational",
  "distraction_state": "distracted"
}
```
