# FocusGuard AI – Phase 9 Architectural Design Document
## User Distraction Notification System

> **Status**: Implemented & Verified (Phase 9)  
> **Target System**: FocusGuard AI (Browser Extension Notification Subsystem)  
> **Author**: FocusGuard AI Engineering Team  

---

## 1. Objective & Purpose

In **Phase 8**, FocusGuard AI implemented multi-signal distraction detection.
The objective of **Phase 9** is to introduce a respectful, non-intrusive, and spam-free **User Distraction Notification System** that alerts the user when they cross from a productive or neutral state into a distracted state.

---

## 2. Notification Flow & Decision Logic

```
                    Productive / Neutral State
                                │
                                ▼
                   Distraction Event Detected
                   (calculateDistractionState)
                                │
                                ▼
                   Check State Transition
               (checkDistractionTransition)
                                │
                        Is Transition INTO
                          DISTRACTED?
                          /          \
                        YES           NO
                        /               \
                       ▼                 ▼
             Check 15-Min Cooldown   Do Nothing
             (last_distraction_notif)
                     /       \
                  ELAPSED   ACTIVE
                   /           \
                  ▼             ▼
        Dispatch Notification   Suppress
       (chrome.notifications)  (Do Nothing)
                  │
                  ▼
         Persist Timestamp
       (chrome.storage.local)
```

---

## 3. Core Notification Invariants

1. **Leading-Edge Trigger Only**:
   - `PRODUCTIVE` $\longrightarrow$ `DISTRACTED` $\implies$ **Trigger Eligible**.
   - `NEUTRAL` $\longrightarrow$ `DISTRACTED` $\implies$ **Trigger Eligible**.
   - `DISTRACTED` $\longrightarrow$ `DISTRACTED` $\implies$ **Suppressed (Zero Spam)**.
2. **15-Minute Prototype Cooldown**:
   - Even if multiple switches occur after entering a distracted state, subsequent notifications are strictly suppressed for **15 minutes** ($900,000\text{ ms}$).
3. **State Recovery**:
   - When the user returns to a `PRODUCTIVE` or `NEUTRAL` state, `lastDistractionState` resets, allowing a new notification on the next genuine distraction event once the cooldown has elapsed.
4. **Non-Intrusive UX**:
   - Zero popups, zero tab redirections, zero tab closures, zero blocking overlays.

---

## 4. Manifest & Chrome Extension Notification API

### Manifest Permission (`manifest.json`):
```json
{
  "permissions": [
    "tabs",
    "storage",
    "notifications"
  ]
}
```

### Notification Payload:
```javascript
const notifOptions = {
  type: 'basic',
  iconUrl: 'icons/icon48.png',
  title: 'FocusGuard AI',
  message: 'You may be getting distracted. Take a moment to refocus.',
  priority: 1
};
chrome.notifications.create(`fg_distraction_${Date.now()}`, notifOptions);
```

---

## 5. Storage Schema

Stored under `chrome.storage.local`:

```json
{
  "last_distraction_notification": 1788284374706
}
```

---

## 6. Privacy Safeguards

- **Zero Sensitive Context**: The notification message never mentions specific domain URLs, search queries, page text, form data, keystrokes, or private user information.
- **Zero Cloud Egress**: Notification decisions and timestamps are computed and stored 100% on-device.

---

## 7. Testing & Verification

1. `test_phase9_notifications.js` verifies all 12 test scenarios:
   - State transition triggers (`productive -> distracted`, `neutral -> distracted`).
   - Duplicate prevention (`distracted -> distracted`).
   - Active cooldown suppression ($< 15\text{ min}$) and expiration re-activation ($\ge 15\text{ min}$).
   - State recovery upon returning to productive/neutral.
   - Non-educational, unknown, and idle isolated safety checks (0 notifications).
   - Team 2 JSON schema preservation.
