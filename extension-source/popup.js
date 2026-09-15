/**
 * FocusGuard AI – Popup Controller
 *
 * Responsibilities:
 * - Loads active session, completed activity history, current hour metrics, and switch data from chrome.storage.local.
 * - Reconciles active session with background worker via POPUP_OPENED message.
 * - Runs a lightweight, client-side live timer for the active session (no storage writes).
 * - Dynamically renders current hour window, hourly switch count, focus status, and recent switches.
 * - Evaluates productivity status based on configurable threshold (< 10 Productive, = 10 Neutral, > 10 Distracted).
 * - Handles data refresh and clearing operations.
 */

// Prototype switch threshold configuration
const SWITCH_THRESHOLD = 10;

// DOM Elements
const currentDomainEl = document.getElementById('current-domain');
const currentTimerEl = document.getElementById('current-timer');
const statusBadgeEl = document.getElementById('status-badge');
const statusTextEl = document.getElementById('status-text');
const currentHourStatEl = document.getElementById('current-hour-stat');
const switchCountStatEl = document.getElementById('switch-count-stat');
const focusStatusBadgeEl = document.getElementById('focus-status-badge');
const totalTimeStatEl = document.getElementById('total-time-stat');
const switchCountTagEl = document.getElementById('switch-count-tag');
const switchesListEl = document.getElementById('switches-list');
const emptySwitchesEl = document.getElementById('empty-switches');
const sessionCountTagEl = document.getElementById('session-count-tag');
const activityTbodyEl = document.getElementById('activity-tbody');
const emptyStateEl = document.getElementById('empty-state');
const btnRefresh = document.getElementById('btn-refresh');
const btnClear = document.getElementById('btn-clear');

// Local timer and daily accumulation state
let timerInterval = null;
let activeSessionStartTime = null;
let activeSessionRef = null;
let todayCompletedDuration = 0;
const SLEEP_GAP_THRESHOLD_MS = 60 * 1000; // 60s conservative sleep gap guard

/* ==========================================================================
   Formatting & Date Utilities
   ========================================================================== */

/**
 * Checks if a given date or ISO string belongs to today's local calendar day.
 *
 * @param {string|Date} dateInput
 * @param {Date} [now=new Date()]
 * @returns {boolean}
 */
function isToday(dateInput, now = new Date()) {
  if (!dateInput) return false;
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return false;
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  } catch (e) {
    return false;
  }
}

/**
 * Returns the fixed 1-hour window string for a given date in local time.
 *
 * @param {Date|string|number} [dateInput=new Date()]
 * @returns {string} - e.g. '09:00–10:00'
 */
function getCurrentHourWindow(dateInput = new Date()) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    return '00:00–01:00';
  }
  const startHour = d.getHours();
  const endHour = (startHour + 1) % 24;
  const pad = (num) => String(num).padStart(2, '0');
  return `${pad(startHour)}:00–${pad(endHour)}:00`;
}

/**
 * Formats a duration in seconds into 'MM:SS' or 'HH:MM:SS'.
 *
 * Examples:
 * - 45   -> '00:45'
 * - 330  -> '05:30'
 * - 3665 -> '01:01:05'
 *
 * @param {number} totalSeconds - Duration in seconds.
 * @returns {string} - Formatted time string.
 */
function formatDuration(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds <= 0) {
    return '00:00';
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const pad = (num) => String(num).padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Formats an ISO-8601 timestamp string into a user-friendly local time (e.g., '18:28').
 *
 * @param {string} isoString - ISO date string.
 * @returns {string} - Localized time string.
 */
function formatTime(isoString) {
  if (!isoString) {
    return '--:--';
  }
  try {
    const date = new Date(isoString);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch (e) {
    return '--:--';
  }
}

/**
 * Escapes HTML characters to prevent XSS.
 *
 * @param {string} str - Raw string.
 * @returns {string} - Escaped HTML-safe string.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ==========================================================================
   UI Update Functions
   ========================================================================== */

/**
 * Accurately computes active elapsed browsing seconds for the ongoing session,
 * excluding sleep/suspend time and paused/idle durations.
 *
 * @param {number} [nowMs=Date.now()]
 * @returns {number}
 */
function computeActiveSessionElapsedSeconds(nowMs = Date.now()) {
  if (!activeSessionRef) return 0;

  const accumulatedSec = typeof activeSessionRef.accumulatedActiveMs === 'number'
    ? Math.floor(activeSessionRef.accumulatedActiveMs / 1000)
    : 0;

  // If session is paused due to idle or lock, only show completed active duration
  if (activeSessionRef.isPaused) {
    return accumulatedSec;
  }

  const lastActiveMs = typeof activeSessionRef.lastActiveTime === 'number'
    ? activeSessionRef.lastActiveTime
    : new Date(activeSessionRef.startTime || activeSessionRef.timestamp).getTime();

  const currentChunkMs = Math.max(0, nowMs - lastActiveMs);

  // If chunk exceeds sleep threshold while popup is running, discard the gap
  const clampedChunkSec = (currentChunkMs > SLEEP_GAP_THRESHOLD_MS) ? 0 : Math.floor(currentChunkMs / 1000);

  if (typeof activeSessionRef.accumulatedActiveMs !== 'number') {
    return clampedChunkSec;
  }

  return accumulatedSec + clampedChunkSec;
}

/**
 * Updates the 'Tracked today' UI display, accumulating completed sessions from today
 * plus elapsed seconds from the currently active session (if started today).
 */
function updateTrackedTodayDisplay() {
  if (!totalTimeStatEl) return;

  let totalSeconds = todayCompletedDuration;
  if (activeSessionRef && isToday(activeSessionRef.startTime || activeSessionRef.timestamp)) {
    totalSeconds += computeActiveSessionElapsedSeconds();
  }

  totalTimeStatEl.textContent = formatDuration(totalSeconds);
}

/**
 * Starts the live UI timer for the current active browsing session.
 * Computes elapsed seconds entirely on the client side without storage overhead.
 */
function startLiveTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (!activeSessionRef) {
    currentTimerEl.textContent = '00:00';
    updateTrackedTodayDisplay();
    return;
  }

  function tick() {
    if (!activeSessionRef) {
      currentTimerEl.textContent = '00:00';
      updateTrackedTodayDisplay();
      return;
    }
    const elapsedSeconds = computeActiveSessionElapsedSeconds();
    currentTimerEl.textContent = formatDuration(elapsedSeconds);
    updateTrackedTodayDisplay();
  }

  // Immediate first calculation
  tick();
  timerInterval = setInterval(tick, 1000);
}

/**
 * Updates the active session card and status badge in the popup.
 *
 * @param {Object|null} currentSession - Active session data from storage.
 */
function renderActiveSession(currentSession) {
  activeSessionRef = currentSession;
  const activeDomain = currentSession ? (currentSession.name || currentSession.domain) : null;
  const activeStart = currentSession ? (currentSession.startTime || currentSession.timestamp) : null;

  if (currentSession && activeDomain && activeStart) {
    activeSessionStartTime = activeStart;
    currentDomainEl.textContent = activeDomain;
    currentDomainEl.classList.remove('inactive');

    if (currentSession.isPaused) {
      statusBadgeEl.className = 'status-badge paused';
      statusTextEl.textContent = currentSession.idleState === 'locked' ? 'Locked' : 'Paused';
    } else {
      statusBadgeEl.className = 'status-badge active';
      statusTextEl.textContent = 'Active';
    }
    startLiveTimer();
  } else {
    activeSessionStartTime = null;
    activeSessionRef = null;
    currentDomainEl.textContent = 'No Active Web Tab';
    currentDomainEl.classList.add('inactive');
    currentTimerEl.textContent = '00:00';

    statusBadgeEl.className = 'status-badge paused';
    statusTextEl.textContent = 'Paused';

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    updateTrackedTodayDisplay();
  }
}

/**
 * Renders hourly switch statistics, current hour window, status badge, and the recent switches list.
 *
 * @param {Object|null} currentHour - Current hour object { hour, switch_count, classification }.
 * @param {Array} switchEvents - List of switch event records.
 */
function renderSwitchData(currentHour, switchEvents) {
  let rawHour = (currentHour && currentHour.hour) || getCurrentHourWindow();
  const hourWindow = rawHour.replace('-', '–');
  const count = (currentHour && typeof currentHour.switch_count === 'number') ? currentHour.switch_count : 0;
  const events = Array.isArray(switchEvents) ? switchEvents : [];

  if (currentHourStatEl) {
    currentHourStatEl.textContent = hourWindow;
  }

  if (switchCountStatEl) {
    switchCountStatEl.textContent = String(count);
  }

  if (switchCountTagEl) {
    switchCountTagEl.textContent = `${events.length}`;
  }

  // Evaluate Focus Status based on prototype threshold
  if (focusStatusBadgeEl) {
    if (count < SWITCH_THRESHOLD) {
      focusStatusBadgeEl.className = 'focus-badge status-productive';
      focusStatusBadgeEl.textContent = 'Productive';
      focusStatusBadgeEl.title = `Current hour switch count (${count}) < ${SWITCH_THRESHOLD}`;
    } else if (count === SWITCH_THRESHOLD) {
      focusStatusBadgeEl.className = 'focus-badge status-neutral';
      focusStatusBadgeEl.textContent = 'Neutral';
      focusStatusBadgeEl.title = `Current hour switch count exactly at boundary threshold (${SWITCH_THRESHOLD})`;
    } else {
      focusStatusBadgeEl.className = 'focus-badge status-distracted';
      focusStatusBadgeEl.textContent = 'Distracted';
      focusStatusBadgeEl.title = `Current hour switch count (${count}) > ${SWITCH_THRESHOLD}`;
    }
  }

  // Render recent switches collapsible feed (showing latest 5-10 switches)
  if (switchesListEl && emptySwitchesEl) {
    switchesListEl.innerHTML = '';
    if (events.length === 0) {
      emptySwitchesEl.classList.remove('hidden');
    } else {
      emptySwitchesEl.classList.add('hidden');
      events.slice(0, 10).forEach((ev) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'switch-item';
        itemEl.innerHTML = `
          <div class="switch-route">
            <span class="switch-domain from" title="${escapeHtml(ev.from)}">${escapeHtml(ev.from)}</span>
            <span class="switch-arrow">→</span>
            <span class="switch-domain to" title="${escapeHtml(ev.to)}">${escapeHtml(ev.to)}</span>
          </div>
          <span class="switch-time">${escapeHtml(formatTime(ev.timestamp))}</span>
        `;
        switchesListEl.appendChild(itemEl);
      });
    }
  }
}

/**
 * Populates the recent activity table and computes today's tracked duration.
 *
 * @param {Array} sessions - List of completed session objects.
 */
function renderRecentActivity(sessions) {
  activityTbodyEl.innerHTML = '';

  const validSessions = Array.isArray(sessions) ? sessions : [];
  sessionCountTagEl.textContent = `${validSessions.length} record${validSessions.length === 1 ? '' : 's'}`;

  // Reset today's completed duration sum
  todayCompletedDuration = 0;

  validSessions.forEach((sess) => {
    const sessionDuration = typeof sess.duration === 'number' ? sess.duration : (sess.durationSeconds || 0);
    const sessionTime = sess.startTime || sess.timestamp;

    // Accumulate duration only for sessions belonging to current local calendar day
    if (isToday(sessionTime)) {
      todayCompletedDuration += sessionDuration;
    }

    const domainName = sess.name || sess.domain || 'unknown';
    const displayHostname = sess.hostname || domainName;
    const timeDisplay = sess.start_time || formatTime(sessionTime);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-domain" title="${escapeHtml(displayHostname)}">${escapeHtml(domainName)}</td>
      <td class="td-time">${escapeHtml(timeDisplay)}</td>
      <td class="td-duration">${escapeHtml(formatDuration(sessionDuration))}</td>
    `;
    activityTbodyEl.appendChild(tr);
  });

  if (validSessions.length === 0) {
    emptyStateEl.classList.remove('hidden');
  } else {
    emptyStateEl.classList.add('hidden');
  }

  updateTrackedTodayDisplay();
}

/**
 * Main routine to load all data from storage and refresh the entire popup view.
 */
async function loadDataAndRender() {
  try {
    // 1. Instant render from local storage
    const data = await chrome.storage.local.get(['currentSession', 'sessions', 'current_hour', 'hourly_summaries', 'switch_events']);
    renderActiveSession(data.currentSession);
    renderRecentActivity(data.sessions);
    renderSwitchData(data.current_hour, data.switch_events);

    // 2. Reconcile with background script to ensure active tab synchronization
    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'POPUP_OPENED' }, (response) => {
        if (chrome.runtime.lastError) {
          // Service worker waking up or already handled
          return;
        }
        if (response && response.currentSession !== undefined) {
          renderActiveSession(response.currentSession);
        }
      });
    }
  } catch (error) {
    console.error('[FocusGuard Popup] Failed to load data from storage:', error);
  }
}

/* ==========================================================================
   Event Handlers & Initialization
   ========================================================================== */

// Manual Refresh Button
btnRefresh.addEventListener('click', async () => {
  btnRefresh.style.opacity = '0.5';
  await loadDataAndRender();
  setTimeout(() => { btnRefresh.style.opacity = '1'; }, 200);
});

// Clear Data Button
btnClear.addEventListener('click', async () => {
  const confirmed = confirm('Are you sure you want to clear all recorded activity and switch history?');
  if (confirmed) {
    try {
      const resetHour = {
        hour: getCurrentHourWindow().replace('–', '-'),
        switch_count: 0,
        classification: 'productive'
      };
      await chrome.storage.local.set({
        sessions: [],
        current_hour: resetHour,
        hourly_summaries: [],
        switch_events: [],
        lastActiveDomain: null,
        last_distraction_notification: 0,
        lastDistractionState: 'productive'
      });
      await loadDataAndRender();
      console.log('[FocusGuard Popup] Activity & switch history cleared by user');
    } catch (error) {
      console.error('[FocusGuard Popup] Error clearing history:', error);
    }
  }
});

// Automatically re-render if background script updates storage while popup is open
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.currentSession) {
      renderActiveSession(changes.currentSession.newValue);
    }
    if (changes.sessions) {
      renderRecentActivity(changes.sessions.newValue);
    }
    if (changes.current_hour || changes.switch_events) {
      chrome.storage.local.get(['current_hour', 'switch_events'], (data) => {
        renderSwitchData(data.current_hour, data.switch_events);
      });
    }
  }
});

// Clean up timer when popup closes/unloads
window.addEventListener('unload', () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
});

// Initialize on popup opening
document.addEventListener('DOMContentLoaded', () => {
  loadDataAndRender();
});
