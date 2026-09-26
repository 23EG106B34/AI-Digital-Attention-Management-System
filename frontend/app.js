/**
 * FocusGuard AI — Production Application Controller
 * No demo data · Real-time · Premium UX
 */

'use strict';

/* ═══════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════ */
const API = '/api';
const POLL_MS = 5000;

/* ═══════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════ */
const state = {
  token: null,
  refresh: null,
  username: '',
  activeTab: 'dashboard',
  pollTimer: null,
  activeSessionId: null,
  chartCategory: null,
  chartDonut: null,
  lastSwitchCount: 0,
  liveSession: null,
  liveProdSecs: 0,
  liveDistSecs: 0,
  liveActiveApp: null,
  liveSwitches: 0,
};

/* ═══════════════════════════════════════════════════════
   I18N / TRANSLATION HELPER (Milestone 3)
   ═══════════════════════════════════════════════════════ */
function tr(s) {
  try {
    if (window.fgI18n && typeof window.fgI18n.t === 'function') {
      return window.fgI18n.t(s);
    }
  } catch (e) {}
  return s;
}

const GOAL_DISPLAY_LABELS = {
  STUDYING: 'Studying',
  CODING: 'Coding',
  ASSIGNMENT: 'Assignment',
  ONLINE_LEARNING: 'Online Learning',
  GAMES: 'Gaming / Free Play',
  OTHER: 'Other / General Focus',
};

function goalLabel(goalKey) {
  if (!goalKey) return 'Studying';
  const k = String(goalKey).toUpperCase();
  return GOAL_DISPLAY_LABELS[k] || goalKey;
}

/* ═══════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ═══════════════════════════════════════════════════════ */
function toast(msg, type = '') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const translated = tr(msg);
  el.innerHTML = `<span class="toast-dot"></span><span>${htmlEsc(translated)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove());
  }, 3500);
}

/* ═══════════════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════════════ */
function loadToken() {
  state.token = localStorage.getItem('fg_token');
  state.refresh = localStorage.getItem('fg_refresh');
  state.username = localStorage.getItem('fg_user') || '';
}

function saveToken(token, username, refresh = '') {
  state.token = token;
  state.username = username;
  localStorage.setItem('fg_token', token);
  localStorage.setItem('fg_user', username);
  localStorage.setItem('focusguard_access_token', token);
  if (refresh) {
    state.refresh = refresh;
    localStorage.setItem('fg_refresh', refresh);
    localStorage.setItem('focusguard_refresh_token', refresh);
  }
}

function clearToken() {
  state.token = null;
  state.refresh = null;
  state.username = '';
  localStorage.removeItem('fg_token');
  localStorage.removeItem('fg_refresh');
  localStorage.removeItem('fg_user');
  localStorage.removeItem('focusguard_access_token');
  localStorage.removeItem('focusguard_refresh_token');
  localStorage.removeItem('focusguard_session_active');
  document.documentElement.classList.remove('logged-in');
}

async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  let res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401 && state.refresh) {
    try {
      const refreshRes = await fetch(`${API}/auth/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: state.refresh })
      });
      if (refreshRes.ok) {
        const d = await refreshRes.json();
        saveToken(d.access, state.username, d.refresh || state.refresh);
        headers['Authorization'] = `Bearer ${state.token}`;
        res = await fetch(API + path, { ...opts, headers });
        return res;
      }
    } catch {}
    signOut();
    throw new Error('Unauthorized');
  } else if (res.status === 401) {
    signOut();
    throw new Error('Unauthorized');
  }
  return res;
}

/* ═══════════════════════════════════════════════════════
   AUTH & LANDING PAGE PORTAL
   ═══════════════════════════════════════════════════════ */
function showLogin() {
  document.documentElement.classList.remove('logged-in');
  const lp = qs('#landingPage');
  const shell = qs('#appShell');
  if (lp) lp.style.display = 'block';
  if (shell) shell.style.display = 'none';
  showAuthTab('login');
}

function hideLogin() {
  document.documentElement.classList.add('logged-in');
  const lp = qs('#landingPage');
  const shell = qs('#appShell');
  if (lp) lp.style.display = 'none';
  if (shell) shell.style.display = 'flex';
}

function showAuthTab(tab) {
  const tabLogin = qs('#tabBtnLogin');
  const tabReg = qs('#tabBtnRegister');
  const formLogin = qs('#authLoginForm');
  const formReg = qs('#authRegisterForm');

  if (tab === 'register') {
    if (tabLogin) tabLogin.classList.remove('active');
    if (tabReg) tabReg.classList.add('active');
    if (formLogin) formLogin.style.display = 'none';
    if (formReg) formReg.style.display = 'flex';
  } else {
    if (tabReg) tabReg.classList.remove('active');
    if (tabLogin) tabLogin.classList.add('active');
    if (formReg) formReg.style.display = 'none';
    if (formLogin) formLogin.style.display = 'flex';
  }
}

function scrollToAuth() {
  const el = qs('#auth');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

/* ─── Password Visibility Eye Toggle ─── */
function initPasswordToggles() {
  qsa('.password-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = qs(`#${targetId}`);
      if (!input) return;

      const eyeOpen = btn.querySelector('.eye-open');
      const eyeClosed = btn.querySelector('.eye-closed');

      if (input.type === 'password') {
        input.type = 'text';
        if (eyeOpen) eyeOpen.classList.add('hidden');
        if (eyeClosed) eyeClosed.classList.remove('hidden');
      } else {
        input.type = 'password';
        if (eyeOpen) eyeOpen.classList.remove('hidden');
        if (eyeClosed) eyeClosed.classList.add('hidden');
      }
    });
  });
}

qs('#loginBtn')?.addEventListener('click', doLogin);
qs('#loginPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const username = val('loginUsername').trim();
  const password = val('loginPassword');
  const errEl = qs('#authError');

  if (errEl) {
    errEl.textContent = '';
    errEl.classList.remove('show');
  }

  if (!username || !password) {
    showAuthError('Please enter your username and password.');
    return;
  }

  const btn = qs('#loginBtn');
  btn.textContent = 'Signing in…';
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/auth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (res.ok) {
      const d = await res.json();
      saveToken(d.access, username, d.refresh);
      hideLogin();
      initApp();
      toast('Signed in successfully', 'success');
    } else {
      showAuthError('Invalid username or password. Please try again.');
    }
  } catch {
    showAuthError('Cannot reach server. Make sure Django is running on port 8000.');
  } finally {
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>Sign In to FocusGuard`;
    btn.disabled = false;
  }
}

function showAuthError(msg) {
  const el = qs('#authError');
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
  }
}

qs('#registerBtn')?.addEventListener('click', doRegister);
qs('#regPasswordConfirm')?.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });

async function doRegister() {
  const username = val('regUsername').trim();
  const firstName = val('regFirstName').trim();
  const lastName = val('regLastName').trim();
  const email = val('regEmail').trim();
  const password = val('regPassword');
  const passwordConfirm = val('regPasswordConfirm');

  const errEl = qs('#regError');
  const succEl = qs('#regSuccess');
  if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
  if (succEl) { succEl.textContent = ''; succEl.classList.remove('show'); }

  if (!username) {
    showRegError('Username is required.');
    return;
  }
  if (!password || password.length < 6) {
    showRegError('Password must be at least 6 characters long.');
    return;
  }
  if (password !== passwordConfirm) {
    showRegError('Passwords do not match. Please verify.');
    return;
  }

  const btn = qs('#registerBtn');
  btn.textContent = 'Creating Account…';
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/auth/register/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email,
        password,
        first_name: firstName,
        last_name: lastName
      })
    });

    if (res.status === 201) {
      if (succEl) {
        succEl.textContent = '✓ Account created! Signing in automatically…';
        succEl.classList.add('show');
      }

      // Auto login
      const loginRes = await fetch(`${API}/auth/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (loginRes.ok) {
        const d = await loginRes.json();
        saveToken(d.access, username, d.refresh);
        setTimeout(() => {
          hideLogin();
          initApp();
          toast(`Welcome to FocusGuard AI, ${firstName || username}!`, 'success');
        }, 800);
      } else {
        showAuthTab('login');
        showAuthError('Account created! Please enter your credentials to sign in.');
      }
    } else {
      const err = await res.json();
      const msg = err.username ? `Username: ${err.username[0]}` :
                  err.email ? `Email: ${err.email[0]}` :
                  err.password ? `Password: ${err.password[0]}` :
                  'Registration failed. Please check your details.';
      showRegError(msg);
    }
  } catch (e) {
    showRegError('Cannot connect to server. Please try again.');
  } finally {
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>Create Free Account`;
    btn.disabled = false;
  }
}

function showRegError(msg) {
  const el = qs('#regError');
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
  }
}

function signOut() {
  clearToken();
  stopPoll();
  showLogin();
  toast('Signed out');
}

qs('#logoutBtn')?.addEventListener('click', () => signOut());

/* ═══════════════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════════════ */
const TAB_TITLES = {
  dashboard: 'Dashboard',
  switches:  'Context Switches',
  telemetry: 'Browsing Activity',
  system:    'Desktop Apps',
  focus:     'Focus Session',
  goals:     'Goals',
  achievements: 'Badges & Streaks',
  profile:   'Profile',
  'ai-chat': 'AI Assistant',
};


qsa('.nav-item[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function openMobileMenu() {
  qs('.sidebar')?.classList.add('open');
  qs('#sidebarBackdrop')?.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeMobileMenu() {
  qs('.sidebar')?.classList.remove('open');
  qs('#sidebarBackdrop')?.classList.remove('show');
  document.body.style.overflow = '';
}

qs('#menuToggleBtn')?.addEventListener('click', openMobileMenu);
qs('#sidebarCloseBtn')?.addEventListener('click', closeMobileMenu);
qs('#sidebarBackdrop')?.addEventListener('click', closeMobileMenu);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeMobileMenu();
    closeAIReportModal();
  }
});

function switchTab(tab) {
  state.activeTab = tab;
  closeMobileMenu();

  qsa('.nav-item').forEach(el => el.classList.remove('active'));
  qsa('.tab-pane').forEach(el => el.classList.remove('active'));

  const navEl = qs(`.nav-item[data-tab="${tab}"]`);
  const paneEl = qs(`#tab-${tab}`);
  if (navEl) navEl.classList.add('active');
  if (paneEl) paneEl.classList.add('active');

  qs('#pageTitle').textContent = TAB_TITLES[tab] || tab;

  // Load data for specific tabs
  if (tab === 'dashboard') fetchDashboard();
  if (tab === 'switches') fetchSwitches();
  if (tab === 'telemetry') fetchTelemetry();
  if (tab === 'system') fetchSystemData();
  if (tab === 'goals') fetchGoals();
  if (tab === 'achievements') fetchGamificationData();
  if (tab === 'profile') {
    fetchProfile();
    loadTrends(currentTrendsDays || 7);
    const dateInput = qs('#reportDateInput');
    const today = new Date().toISOString().slice(0, 10);
    if (dateInput && !dateInput.value) {
      dateInput.value = today;
    }
    const dateVal = dateInput?.value || today;
    loadDateReport(dateVal);
  }
}

/* ═══════════════════════════════════════════════════════
   DASHBOARD DATA
   ═══════════════════════════════════════════════════════ */
async function fetchDashboard() {
  try {
    const res = await apiFetch('/dashboard/summary/');
    if (!res.ok) return;
    const d = await res.json();
    renderDashboard(d);
    updateLastUpdated();
    fetchLiveVisionStatus();
    fetchGamificationData();
  } catch (err) {
    if (err.message !== 'Unauthorized') console.error('Dashboard error:', err);
  }
}

async function fetchLiveVisionStatus() {
  try {
    const res = await apiFetch('/system/attention/live/');
    if (!res.ok) return;
    const d = await res.json();
    updateLiveVisionUI(d);
  } catch (e) {
    // silent catch
  }
}

function updateLiveVisionUI(d) {
  if (!d) return;

  const badge = qs('#visionStateBadge');
  const icon = qs('#visionStatusIcon');
  const title = qs('#visionStatusTitle');
  const meta = qs('#visionStatusMeta');
  const scoreEl = qs('#visionScoreVal');
  const countEl = qs('#visionPhoneCount');
  const awayEl = qs('#visionAwayTime');

  if (!badge || !title) return;

  if (!d.is_active) {
    badge.className = 'badge badge-neutral';
    badge.textContent = 'STANDBY';
    title.textContent = 'Smart Vision on Standby';
    title.style.color = 'var(--text-900)';
    meta.textContent = 'Camera tracking activates automatically when you start a focus session.';
    if (icon) {
      icon.style.background = 'var(--text-400)';
      icon.style.boxShadow = 'none';
    }
    if (countEl) countEl.textContent = '0 times';
    if (awayEl) awayEl.textContent = formatDuration(0);
    if (scoreEl) scoreEl.textContent = '—';
    return;
  }

  if (countEl) countEl.textContent = `${d.phone_distraction_count || 0} times`;
  if (awayEl) {
    awayEl.textContent = formatDuration(d.away_secs || 0);
  }
  if (scoreEl) {
    if (d.attention_score !== null && d.attention_score !== undefined) {
      scoreEl.textContent = `${Math.round(d.attention_score)}%`;
    } else {
      scoreEl.textContent = '—';
    }
  }

  const state = d.state || 'FOCUSED';
  if (state === 'LOOKING_AT_PHONE') {
    badge.className = 'badge badge-warning';
    badge.textContent = 'PHONE DISTRACTION';
    title.textContent = 'Distracted: Looking Down at Phone';
    title.style.color = 'var(--color-warning, #f59e0b)';
    meta.textContent = 'Head pitched down scrolling phone/lap. Switch back to your work!';
    if (icon) {
      icon.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
      icon.style.boxShadow = '0 4px 12px rgba(245, 158, 11, 0.35)';
    }
  } else if (state === 'LOOKING_AWAY') {
    badge.className = 'badge badge-danger';
    badge.textContent = 'LOOKING AWAY';
    title.textContent = 'Attention Drift: Looking Away';
    title.style.color = 'var(--color-danger, #ef4444)';
    meta.textContent = 'Head turned sideways away from computer screen.';
    if (icon) {
      icon.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
      icon.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.35)';
    }
  } else if (state === 'USER_ABSENT') {
    badge.className = 'badge badge-neutral';
    badge.textContent = 'AWAY';
    title.textContent = 'User Away from Desk';
    title.style.color = 'var(--text-700)';
    meta.textContent = 'No face detected in webcam view.';
    if (icon) {
      icon.style.background = 'var(--text-400)';
      icon.style.boxShadow = 'none';
    }
  } else {
    badge.className = 'badge badge-success';
    badge.textContent = 'FOCUSED';
    title.textContent = 'User Focused on Screen';
    title.style.color = 'var(--text-900)';
    meta.textContent = 'Head and gaze oriented toward display. Great focus!';
    if (icon) {
      icon.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
      icon.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.25)';
    }
  }
}


function formatDuration(totalSecs) {
  const s = Math.max(0, Math.round(totalSecs || 0));
  const mins = Math.floor(s / 60);
  const remSecs = s % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m ${remSecs}s`;
}

function renderDashboard(d) {
  const isActive = !!(d.is_session_active && d.active_focus_session);

  if (isActive) {
    state.liveSession = d.active_focus_session;
    state.liveActiveApp = d.active_app;
    state.liveProdSecs = Math.max(state.liveProdSecs || 0, d.productive_secs ?? d.active_focus_session.productive_secs ?? 0);
    state.liveDistSecs = Math.max(state.liveDistSecs || 0, d.distracted_secs ?? d.active_focus_session.distracted_secs ?? 0);
    state.liveSwitches = d.total_switches ?? d.active_focus_session.switches ?? 0;

    // Use switch-penalized score from server (already accounts for NEUTRAL app time)
    const pScore = d.productivity_score !== null && d.productivity_score !== undefined
      ? Math.round(d.productivity_score)
      : (state.liveDistSecs === 0 ? 100 : Math.round((state.liveProdSecs / Math.max(1, state.liveProdSecs + state.liveDistSecs)) * 100));
    const rawPct = d.raw_productive_pct !== null && d.raw_productive_pct !== undefined
      ? Math.round(d.raw_productive_pct) : pScore;
    const sw = state.liveSwitches || 0;
    const swPenalty = Math.min(30, Math.round(sw * 1.5));

    setEl('prodVal', formatDuration(state.liveProdSecs));
    setEl('prodMeta', `Active Session · ${rawPct}% productive ratio`);

    setEl('distVal', formatDuration(state.liveDistSecs));
    setEl('distMeta', state.liveDistSecs > 0 ? `${formatDuration(state.liveDistSecs)} off-task` : 'No distracting apps detected');

    setEl('switchVal', sw);
    setEl('switchMeta', sw === 0 ? 'Zero switches · Deep focus' : `${sw} context switch${sw !== 1 ? 'es' : ''} in session`);

    setEl('scoreVal', `${pScore}%`);
    const scoreLabel = pScore >= 70 ? 'High Focus' : pScore >= 40 ? 'Moderate' : 'Needs Focus';
    setEl('scoreMeta', sw > 0 ? `${rawPct}% productive · −${swPenalty}pts (${sw} switches) · ${scoreLabel}` : `${rawPct}% productive · ${scoreLabel}`);

  } else {
    state.liveSession = null;
    const prodS = d.productive_secs ?? Math.round((d.productive_hours || 0) * 3600);
    const distS = d.distracted_secs ?? Math.round((d.distracted_hours || 0) * 3600);
    const totS = prodS + distS;
    const sw = d.total_switches ?? 0;
    // productivity_score is already switch-penalized from backend
    const hasData = d.total_secs > 0 && d.productivity_score !== null && d.productivity_score !== undefined;
    const pScore = hasData ? Math.round(d.productivity_score) : null;
    const rawPct = hasData && d.raw_productive_pct !== null && d.raw_productive_pct !== undefined
      ? Math.round(d.raw_productive_pct) : pScore;
    const swPenalty = hasData ? Math.min(30, Math.round(sw * 1.5)) : 0;

    setEl('prodVal', prodS > 0 ? formatDuration(prodS) : '—');
    setEl('prodMeta', prodS > 0 && rawPct !== null ? `${rawPct}% productive ratio today` : 'Ready to track');

    // Show 0s when there IS productive time but no distracting apps — not —
    setEl('distVal', distS > 0 ? formatDuration(distS) : (prodS > 0 ? formatDuration(0) : '—'));
    setEl('distMeta', distS > 0 ? `${formatDuration(distS)} total distracted time` : (prodS > 0 ? 'No distracting apps detected' : 'Total distraction time'));

    setEl('switchVal', sw > 0 ? sw : '—');
    setEl('switchMeta', sw === 0 ? 'No switches recorded yet' : `${sw} context change${sw !== 1 ? 's' : ''} today`);

    if (pScore !== null) {
      setEl('scoreVal', `${pScore}%`);
      const scoreLabel = pScore >= 70 ? 'High Focus' : pScore >= 40 ? 'Moderate' : 'Needs Focus';
      if (sw > 0 && swPenalty > 0) {
        setEl('scoreMeta', `${rawPct}% productive · −${swPenalty}pts (${sw} switches) · ${scoreLabel}`);
      } else {
        setEl('scoreMeta', `${rawPct}% productive · ${scoreLabel}`);
      }
    } else {
      setEl('scoreVal', '—');
      setEl('scoreMeta', 'Start a session to calculate');
    }
  }

  // Badge on sidebar
  const totalSw = d.total_switches ?? 0;
  if (totalSw !== state.lastSwitchCount) {
    state.lastSwitchCount = totalSw;
    const badge = qs('#switchBadge');
    if (totalSw > 0) { badge.textContent = totalSw > 99 ? '99+' : totalSw; badge.classList.add('show'); }
    else badge.classList.remove('show');
  }

  if (d.ai_insight) {
    const insightKey = (d.ai_insight.id || '') + '_' + (d.ai_insight.generated_at || '');
    if (state.lastInsightKey !== insightKey) {
      state.lastInsightKey = insightKey;
      setEl('aiInsightText', d.ai_insight.insights_text || '', false, false);
      qs('#aiInsightText').className = 'insight-text';
      qs('#aiTimestamp').textContent = d.ai_insight.generated_at
        ? `Generated at ${new Date(d.ai_insight.generated_at).toLocaleTimeString()}`
        : 'Generated today';

      const recs = Array.isArray(d.ai_insight.recommendations) ? d.ai_insight.recommendations : [];
      const grid = qs('#recGrid');
      if (grid) {
        grid.innerHTML = recs.map(r => `
          <div class="rec-item">
            <div class="rec-title"><span class="rec-icon">💡</span>${r.title || ''}</div>
            <div class="rec-body">${r.detail || r.text || ''}</div>
          </div>
        `).join('');
      }
    }
  }

  state.lastDashboardData = d;

  // Live Focus Session Banner Controller
  updateDashSessionUI(d.active_focus_session);

  // Today's Isolated Focus Sessions List
  renderTodayFocusSessions(d.today_sessions || []);

  // Stat: extension status
  const isExtActiveOnPage = document.documentElement.getAttribute('data-focusguard-extension') === 'connected';
  const hasExtData = Boolean(d.extension_connected || isExtActiveOnPage || (d.browser_total_secs > 0) || (d.top_sites && d.top_sites.length > 0));
  const extValEl = qs('#extVal');
  if (extValEl) {
    const txt = hasExtData ? 'Connected' : 'Offline';
    if (extValEl.textContent !== txt) extValEl.textContent = txt;
    const col = hasExtData ? 'var(--color-success)' : 'var(--text-300)';
    if (extValEl.style.color !== col) extValEl.style.color = col;
  }
  let extMetaText = 'Install & connect extension';
  if (hasExtData) {
    if (d.is_session_active) {
      extMetaText = (d.browser_total_secs > 0)
        ? `Live · ${formatDuration(d.browser_total_secs)} active web time`
        : 'Live · Tracking browser tabs';
    } else {
      extMetaText = (d.browser_total_secs > 0)
        ? `${formatDuration(d.browser_total_secs)} web time logged today`
        : 'Ready · Synced with browser';
    }
  }
  setEl('extMeta', extMetaText);

  // Charts
  renderCategoryChart(d.category_breakdown || {});
  renderDonut(d.productive_pct || 0, d.distracting_pct || 0);

  // Top sites
  renderSitesTable('topSitesBody', d.top_sites || []);
  const count = d.top_sites?.length || 0;
  const siteCountEl = qs('#siteCount');
  if (siteCountEl) {
    if (count > 0) {
      const sTxt = `${count} sites`;
      if (siteCountEl.textContent !== sTxt) siteCountEl.textContent = sTxt;
      if (siteCountEl.style.display !== 'inline-flex') siteCountEl.style.display = 'inline-flex';
    } else if (siteCountEl.style.display !== 'none') {
      siteCountEl.style.display = 'none';
    }
  }

  // Top desktop apps
  const appTbody = qs('#dashTopAppsBody');
  if (appTbody) {
    const apps = d.top_apps || [];
    const jsonApps = JSON.stringify(apps);
    if (appTbody.dataset.lastJson !== jsonApps) {
      appTbody.dataset.lastJson = jsonApps;
      const appCountEl = qs('#appCount');
      if (apps.length > 0) {
        if (appCountEl) { appCountEl.textContent = `${apps.length} apps`; appCountEl.style.display = 'inline-flex'; }
        appTbody.innerHTML = apps.map(app => {
          const label = app.productivity_label || 'NEUTRAL';
          const bc = label === 'PRODUCTIVE' ? 'badge-productive' : label === 'DISTRACTING' ? 'badge-distracting' : 'badge-neutral';
          return `
            <tr>
              <td class="td-primary">${htmlEsc(app.app_name || app.process_name)}</td>
              <td><span class="category-tag">${app.category || '—'}</span></td>
              <td><span class="badge ${bc}">${label}</span></td>
              <td style="font-variant-numeric:tabular-nums;font-weight:600;color:var(--text-700);">${formatDuration(app.total_secs)}</td>
            </tr>
          `;
        }).join('');
      } else {
        if (appCountEl) appCountEl.style.display = 'none';
        appTbody.innerHTML = emptyRow(4, '🖥️', 'No desktop apps tracked yet today', 'Start a focus session to track your active applications.');
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════
   CONTEXT SWITCHES
   ═══════════════════════════════════════════════════════ */
async function fetchSwitches() {
  try {
    const res = await apiFetch('/browsing/switches/today/');
    if (!res.ok) return;
    const d = await res.json();
    renderSwitches(d);
  } catch (err) {
    if (err.message !== 'Unauthorized') console.error('Switches error:', err);
  }
}

function renderSwitches(d) {
  const total = d.total_switches || 0;
  setEl('swTotalVal', total);

  // Fragmentation
  let label = 'None', pct = 0, color = 'var(--color-success)';
  if (total >= 80) { label = 'Very High'; pct = 100; color = 'var(--color-rose)'; }
  else if (total >= 50) { label = 'High'; pct = 75; color = 'var(--color-danger)'; }
  else if (total >= 25) { label = 'Moderate'; pct = 45; color = 'var(--color-warning)'; }
  else if (total >= 10) { label = 'Low'; pct = 20; color = 'var(--color-success)'; }
  else if (total > 0) { label = 'Minimal'; pct = 8; color = 'var(--color-teal)'; }

  const fragEl = qs('#swFragVal');
  fragEl.textContent = label;
  fragEl.style.color = color;
  qs('#swFragBar').style.width = pct + '%';
  qs('#swFragBar').style.background = color;

  // Top switch
  const top = d.top_transitions?.[0];
  if (top) {
    qs('#swTopVal').textContent = `${top.from_domain} → ${top.to_domain}`;
    setEl('swTopCount', `Repeated ${top.count} times`);
  } else {
    setEl('swTopVal', 'No data yet');
    setEl('swTopCount', 'Switch tabs to start tracking');
  }

  // Transitions table
  const tbody = qs('#transitionsBody');
  if (tbody) {
    const tJson = JSON.stringify(d.top_transitions || []);
    if (tbody.dataset.lastJson !== tJson) {
      tbody.dataset.lastJson = tJson;
      if (d.top_transitions?.length > 0) {
        tbody.innerHTML = d.top_transitions.map(t => `
          <tr>
            <td><span class="domain-chip">${faviconImg(t.from_domain)}${t.from_domain || '—'}</span></td>
            <td style="text-align:center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-300)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></td>
            <td><span class="domain-chip">${faviconImg(t.to_domain)}${t.to_domain || '—'}</span></td>
            <td>
              <span class="category-tag">${t.from_category || '—'}</span>
              <span style="margin: 0 3px; color: var(--text-300);">→</span>
              <span class="category-tag">${t.to_category || '—'}</span>
            </td>
            <td><strong style="color:var(--text-900);">${t.count}</strong></td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = emptyRow(5, '🔄', 'No switch data yet', 'Switch between browser tabs and data appears here automatically.');
      }
    }
  }

  // Timeline
  const timeline = qs('#switchTimeline');
  if (timeline) {
    const sJson = JSON.stringify(d.recent_switches || []);
    if (timeline.dataset.lastJson !== sJson) {
      timeline.dataset.lastJson = sJson;
      if (d.recent_switches?.length > 0) {
        timeline.innerHTML = d.recent_switches.map((s, i) => {
          const t = s.switched_at ? new Date(s.switched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
          const isLast = i === d.recent_switches.length - 1;
          return `
            <div class="timeline-item">
              <div class="timeline-dot-col">
                <div class="timeline-dot"></div>
                ${!isLast ? '<div class="timeline-line"></div>' : ''}
              </div>
              <div class="timeline-content">
                <div class="timeline-header">
                  <div class="timeline-main">
                    <span class="domain-chip" style="max-width:120px;">${faviconImg(s.from_domain)}${s.from_domain || '—'}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-300)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    <span class="domain-chip" style="max-width:120px;">${faviconImg(s.to_domain)}${s.to_domain || '—'}</span>
                  </div>
                  <span class="timeline-time">${t}</span>
                </div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        timeline.innerHTML = `
          <div class="empty">
            <div class="empty-icon">🕒</div>
            <div class="empty-title">No recent switches</div>
            <div class="empty-desc">Live events will appear here as you switch browser tabs.</div>
          </div>`;
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════
   TELEMETRY
   ═══════════════════════════════════════════════════════ */
async function fetchTelemetry() {
  try {
    const res = await apiFetch('/browsing/logs/');
    if (res.ok) {
      const d = await res.json();
      const logs = Array.isArray(d) ? d : (d.results || []);
      const sites = logs.map(l => ({
        domain: l.domain,
        page_title: l.page_title,
        category: l.category,
        productivity_label: l.productivity_label,
        total_secs: l.time_spent_secs
      }));
      renderSitesTable('telemetryBody', sites);
      return;
    }
  } catch (err) {
    if (err.message !== 'Unauthorized') console.error('Telemetry error:', err);
  }
  try {
    const res = await apiFetch('/dashboard/summary/');
    if (!res.ok) return;
    const d = await res.json();
    renderSitesTable('telemetryBody', d.top_sites || []);
  } catch (err) {}
}

/* ═══════════════════════════════════════════════════════
   SYSTEM APP MONITOR
   ═══════════════════════════════════════════════════════ */
async function fetchSystemData() {
  try {
    const res = await apiFetch('/system/today/');
    if (!res.ok) return;
    const d = await res.json();
    renderSystemData(d);
  } catch (err) {
    if (err.message !== 'Unauthorized') console.error('System monitor error:', err);
  }
}

function renderSystemData(d) {
  // Active app card
  const active = d.active_app;
  const activeNameEl = qs('#activeAppName');
  const activeTitleEl = qs('#activeAppTitle');
  const activeCatEl = qs('#activeAppCategory');
  const activeTierEl = qs('#activeAppTier');

  if (active && active.app_name) {
    if (activeNameEl && activeNameEl.textContent !== active.app_name) activeNameEl.textContent = active.app_name;
    const tit = active.window_title || active.process_name || '';
    if (activeTitleEl && activeTitleEl.textContent !== tit) activeTitleEl.textContent = tit;
    const cat = active.category || '';
    if (activeCatEl && activeCatEl.textContent !== cat) activeCatEl.textContent = cat;
    if (activeTierEl) {
      const tier = active.productivity_label || 'NEUTRAL';
      const bc = tier === 'PRODUCTIVE' ? 'badge-productive' : tier === 'DISTRACTING' ? 'badge-distracting' : 'badge-neutral';
      const tierHtml = `<span class="badge ${bc}">${tier}</span>`;
      if (activeTierEl.innerHTML !== tierHtml) activeTierEl.innerHTML = tierHtml;
    }
  } else {
    if (activeNameEl && activeNameEl.textContent !== 'No App Active') activeNameEl.textContent = 'No App Active';
    const sub = 'Start a focus session to automatically track active applications';
    if (activeTitleEl && activeTitleEl.textContent !== sub) activeTitleEl.textContent = sub;
    if (activeCatEl && activeCatEl.textContent !== '') activeCatEl.textContent = '';
    const offHtml = '<span class="badge badge-neutral">STANDBY</span>';
    if (activeTierEl && activeTierEl.innerHTML !== offHtml) activeTierEl.innerHTML = offHtml;
  }

  // Stat cards
  const prodSecs = d.productive_secs || 0;
  setEl('sysProdVal', formatDuration(prodSecs));
  setEl('sysProdMeta', `${d.productive_pct || 0}% of desktop time`);

  const sw = d.total_switches ?? 0;
  setEl('sysSwitchVal', sw);

  const totalSecs = d.total_secs || 0;
  setEl('sysTimeVal', formatDuration(totalSecs));

  // Top apps table
  const tbody = qs('#sysAppsBody');
  if (tbody) {
    const apps = d.top_apps || [];
    const aJson = JSON.stringify(apps);
    if (tbody.dataset.lastJson !== aJson) {
      tbody.dataset.lastJson = aJson;
      if (apps.length === 0) {
        tbody.innerHTML = emptyRow(4, '🖥️', 'No desktop app activity recorded today', 'Start a focus session to track your active applications.');
      } else {
        tbody.innerHTML = apps.map(app => {
          const label = app.productivity_label || 'NEUTRAL';
          const bc = label === 'PRODUCTIVE' ? 'badge-productive' : label === 'DISTRACTING' ? 'badge-distracting' : 'badge-neutral';
          return `
            <tr>
              <td class="td-primary">${htmlEsc(app.app_name || app.process_name)}</td>
              <td><span class="category-tag">${app.category || '—'}</span></td>
              <td><span class="badge ${bc}">${label}</span></td>
              <td style="font-variant-numeric:tabular-nums;font-weight:600;color:var(--text-700);">${formatDuration(app.total_secs)}</td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  // App Switch Timeline
  const timeline = qs('#sysTimeline');
  if (timeline) {
    const switches = d.recent_switches || [];
    const swJson = JSON.stringify(switches);
    if (timeline.dataset.lastJson !== swJson) {
      timeline.dataset.lastJson = swJson;
      if (switches.length === 0) {
        timeline.innerHTML = `
          <div class="empty">
            <div class="empty-icon">⏳</div>
            <div class="empty-title">No switches recorded yet</div>
            <div class="empty-desc">Switch between applications and events appear here in real-time.</div>
          </div>`;
      } else {
        timeline.innerHTML = switches.map((s, i) => {
          const t = s.switched_at ? new Date(s.switched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
          const isLast = i === switches.length - 1;
          return `
            <div class="timeline-item">
              <div class="timeline-dot-col">
                <div class="timeline-dot"></div>
                ${!isLast ? '<div class="timeline-line"></div>' : ''}
              </div>
              <div class="timeline-content">
                <div class="timeline-header">
                  <div class="timeline-main">
                    <span class="domain-chip" style="font-weight:600;">${htmlEsc(s.from_app || 'App')}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-300)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    <span class="domain-chip" style="font-weight:600;">${htmlEsc(s.to_app || 'App')}</span>
                  </div>
                  <span class="timeline-time">${t}</span>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════
   SITES TABLE
   ═══════════════════════════════════════════════════════ */
function renderSitesTable(bodyId, sites) {
  const tbody = qs(`#${bodyId}`);
  if (!tbody) return;

  const jsonStr = JSON.stringify(sites || []);
  if (tbody.dataset.lastJson === jsonStr) return;
  tbody.dataset.lastJson = jsonStr;

  if (!sites || !sites.length) {
    tbody.innerHTML = emptyRow(5, '🌐', 'No browsing data yet', 'Install the Chrome Extension, sign in, and browse websites. Data appears here instantly.');
    return;
  }

  tbody.innerHTML = sites.map(s => {
    const label = s.productivity_label || 'NEUTRAL';
    const bc = label === 'PRODUCTIVE' ? 'badge-productive' : label === 'DISTRACTING' ? 'badge-distracting' : 'badge-neutral';
    const title = s.page_title || s.domain;
    return `
      <tr>
        <td class="td-primary" title="${htmlEsc(title)}">${htmlEsc(title)}</td>
        <td class="td-domain">${faviconImg(s.domain)}${s.domain}</td>
        <td><span class="category-tag">${s.category || '—'}</span></td>
        <td><span class="badge ${bc}">${label}</span></td>
        <td style="font-variant-numeric:tabular-nums; font-weight:600; color:var(--text-700);">${formatDuration(s.total_secs)}</td>
      </tr>
    `;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   CHARTS
   ═══════════════════════════════════════════════════════ */
const CAT_COLORS = {
  PRODUCTIVE:   '#10b981', DEVELOPMENT:  '#6366f1', EDUCATION:    '#3b82f6',
  CREATIVE:     '#8b5cf6', COMMUNICATION:'#f59e0b', FINANCE:      '#14b8a6',
  SYSTEM:       '#94a3b8', NEWS_READING: '#64748b', ENTERTAINMENT:'#ef4444',
  SOCIAL_MEDIA: '#ec4899', GAMING:       '#dc2626', SHOPPING:     '#d97706'
};

const CAT_EMOJIS = {
  PRODUCTIVE:'🎯',DEVELOPMENT:'💻',EDUCATION:'📚',CREATIVE:'🎨',COMMUNICATION:'💬',
  FINANCE:'💰',SYSTEM:'⚙️',NEWS_READING:'📰',ENTERTAINMENT:'🎬',SOCIAL_MEDIA:'📱',
  GAMING:'🎮',SHOPPING:'🛒'
};

function renderCategoryChart(breakdown) {
  const ctx = qs('#categoryChart');
  const emptyEl = qs('#categoryChartEmpty');
  const wrapEl = qs('#categoryChartWrap');
  if (!ctx) return;

  const entries = Object.entries(breakdown || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    if (emptyEl && emptyEl.style.display !== 'flex') emptyEl.style.display = 'flex';
    if (wrapEl && wrapEl.style.display !== 'none') wrapEl.style.display = 'none';
    return;
  }

  if (emptyEl && emptyEl.style.display !== 'none') emptyEl.style.display = 'none';
  if (wrapEl && wrapEl.style.display !== 'block') wrapEl.style.display = 'block';

  const newLabels = entries.map(([k]) => `${CAT_EMOJIS[k] || ''} ${k}`);
  const newData = entries.map(([, v]) => v);
  const newBg = entries.map(([k]) => (CAT_COLORS[k] || '#94a3b8') + 'dd');
  const newHover = entries.map(([k]) => CAT_COLORS[k] || '#94a3b8');

  if (state.chartCategory) {
    const curLabels = state.chartCategory.data.labels || [];
    const curData = state.chartCategory.data.datasets[0].data || [];
    if (JSON.stringify(curLabels) === JSON.stringify(newLabels) &&
        JSON.stringify(curData) === JSON.stringify(newData)) {
      return;
    }
    // Smooth in-place data update: NO FLICKER, NO CANVAS RECREATION
    state.chartCategory.data.labels = newLabels;
    state.chartCategory.data.datasets[0].data = newData;
    state.chartCategory.data.datasets[0].backgroundColor = newBg;
    state.chartCategory.data.datasets[0].hoverBackgroundColor = newHover;
    state.chartCategory.update('none');
    return;
  }

  // Create chart once on initial load
  state.chartCategory = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: newLabels,
      datasets: [{
        label: 'Minutes',
        data: newData,
        backgroundColor: newBg,
        hoverBackgroundColor: newHover,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e2030',
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          padding: 10,
          cornerRadius: 8,
          callbacks: { label: ctx => ` ${ctx.raw} min` }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: '#94a3b8', font: { size: 10, family: 'Inter' } }
        },
        y: {
          grid: { color: '#f1f3f9', drawBorder: false },
          border: { display: false, dash: [3,3] },
          ticks: { color: '#94a3b8', font: { size: 11, family: 'Inter' } }
        }
      }
    }
  });
}

function renderDonut(prodPct, distPct) {
  const ctx = qs('#donutChart');
  if (!ctx) return;

  const neutralPct = Math.max(0, Math.round(100 - prodPct - distPct));
  const newData = prodPct + distPct + neutralPct > 0
    ? [prodPct, distPct, neutralPct]
    : [1, 0, 0];
  const newBg = prodPct + distPct > 0
    ? ['#10b981', '#ef4444', '#e8eaf3']
    : ['#e8eaf3', '#ef4444', '#e8eaf3'];

  if (state.chartDonut) {
    const curData = state.chartDonut.data.datasets[0].data || [];
    if (JSON.stringify(curData) === JSON.stringify(newData)) {
      return;
    }
    // Smooth in-place data update: NO FLICKER
    state.chartDonut.data.datasets[0].data = newData;
    state.chartDonut.data.datasets[0].backgroundColor = newBg;
    state.chartDonut.update('none');
    return;
  }

  // Create donut chart once on initial load
  state.chartDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Productive', 'Distracting', 'Neutral'],
      datasets: [{
        data: newData,
        backgroundColor: newBg,
        borderWidth: 0,
        hoverOffset: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: '75%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#64748b',
            boxWidth: 10,
            boxHeight: 10,
            borderRadius: 2,
            font: { family: 'Inter', size: 12, weight: '500' },
            padding: 16,
          }
        },
        tooltip: {
          backgroundColor: '#1e2030',
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          padding: 10,
          cornerRadius: 8,
          callbacks: { label: ctx => ` ${ctx.raw}%` }
        }
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════
   FOCUS SESSIONS (OPEN-ENDED · NO ARBITRARY TIMERS)
   ═══════════════════════════════════════════════════════ */
async function startFocusSession() {
  const startBtn = qs('#dashStartSessionBtn');
  const endBtn = qs('#dashEndSessionBtn');
  const startTimerBtn = qs('#startTimerBtn');
  const endTimerBtn = qs('#endTimerBtn');

  // Pick goal: prefer whichever select is actually visible or has an explicit selection
  let selectedGoal = 'STUDYING';
  const dashSelect = qs('#focusGoalSelect');
  const tabSelect = qs('#focusTabGoalSelect');
  if (state.activeTab === 'focus' && tabSelect && tabSelect.value) {
    selectedGoal = tabSelect.value;
  } else if (dashSelect && dashSelect.value) {
    selectedGoal = dashSelect.value;
  } else if (tabSelect && tabSelect.value) {
    selectedGoal = tabSelect.value;
  }
  // Sync both selects
  if (dashSelect) dashSelect.value = selectedGoal;
  if (tabSelect) tabSelect.value = selectedGoal;

  const btnLabel = tr('Starting...');
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;"></span> ${btnLabel}`;
  }
  if (startTimerBtn) {
    startTimerBtn.disabled = true;
    startTimerBtn.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;"></span> ${btnLabel}`;
  }

  const resetStartButtons = () => {
    const startTxt = tr('Start Session');
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span data-i18n="Start Session">${startTxt}</span>`;
    }
    if (startTimerBtn) {
      startTimerBtn.disabled = false;
      startTimerBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> ${startTxt}`;
    }
  };

  try {
    const res = await apiFetch('/focus/start/', {
      method: 'POST',
      body: JSON.stringify({
        session_type: 'DEEP_WORK',
        goal: selectedGoal,
        planned_duration_mins: 0
      })
    });
    if (res.ok) {
      const data = await res.json();
      state.activeSessionId = data.id;
      state.currentGoal = data.goal || selectedGoal;
      state.liveProdSecs = 0;
      state.liveDistSecs = 0;
      state.liveNeutSecs = 0;
      state.liveSwitches = 0;
      localStorage.setItem('focusguard_session_active', 'true');
      lastBreakReminderMinute = 0;
      playChime('start');
      setEl('prodVal', formatDuration(0));
      setEl('distVal', formatDuration(0));
      setEl('scoreVal', '—');
      setEl('switchVal', '0');

      // INSTANT ZERO-LATENCY TOGGLE: switch directly to Stop Session
      resetStartButtons();
      if (startBtn) startBtn.style.display = 'none';
      if (startTimerBtn) startTimerBtn.style.display = 'none';

      const stopTxt = tr('Stop Session');
      if (endBtn) {
        endBtn.disabled = false;
        endBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg> <span data-i18n="Stop Session">${stopTxt}</span>`;
        endBtn.style.display = 'inline-flex';
      }
      if (endTimerBtn) {
        endTimerBtn.disabled = false;
        endTimerBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg> ${stopTxt}`;
        endTimerBtn.style.display = 'inline-flex';
      }

      updateDashSessionUI(data);

      const label = goalLabel(selectedGoal);
      toast(`🚀 Focus session started for goal: ${label}!`, 'success');
      fetchDashboard();
    } else {
      resetStartButtons();
      let errMsg = 'Failed to start focus session';
      try {
        const errJson = await res.json();
        if (errJson.error) errMsg = errJson.error;
        else if (errJson.detail) errMsg = errJson.detail;
        else if (errJson.goal) errMsg = `Goal: ${errJson.goal[0] || errJson.goal}`;
      } catch (e) {}
      toast(errMsg, 'danger');
    }
  } catch (e) {
    console.error('Error starting focus session:', e);
    resetStartButtons();
    toast('Error starting focus session', 'danger');
  }
}


async function endFocusSession() {
  const startBtn = qs('#dashStartSessionBtn');
  const endBtn = qs('#dashEndSessionBtn');
  if (endBtn) {
    endBtn.disabled = true;
    endBtn.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;"></span> Stopping...`;
  }
  try {
    const res = await apiFetch('/focus/end/', {
      method: 'POST',
      body: JSON.stringify({ status: 'COMPLETED' })
    });
    if (res.ok) {
      state.activeSessionId = null;
      state.liveSession = null;
      state.liveProdSecs = 0;
      state.liveDistSecs = 0;
      state.liveNeutSecs = 0;
      state.liveSwitches = 0;
      localStorage.setItem('focusguard_session_active', 'false');
      playChime('end');
      closeBreakReminderModal();

      // INSTANT ZERO-LATENCY TOGGLE: switch directly to Start Session
      if (endBtn) {
        endBtn.disabled = false;
        endBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg> Stop Session`;
        endBtn.style.display = 'none';
      }
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Session`;
        startBtn.style.display = 'inline-flex';
      }
      updateDashSessionUI(null);

      toast('🎉 Focus session completed and logged!', 'success');
      fetchDashboard();
      fetchGamificationData();
    } else {
      if (endBtn) {
        endBtn.disabled = false;
        endBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg> Stop Session`;
      }
      toast('Failed to end focus session', 'danger');
    }
  } catch (e) {
    console.error('Error ending focus session:', e);
    if (endBtn) {
      endBtn.disabled = false;
      endBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg> Stop Session`;
    }
    toast('Error ending focus session', 'danger');
  }
}

// Event listeners for tab-focus buttons
qs('#startTimerBtn')?.addEventListener('click', startFocusSession);
qs('#endTimerBtn')?.addEventListener('click', endFocusSession);
function pauseIcon() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
}

/* ═══════════════════════════════════════════════════════
   GOALS CRUD
   ═══════════════════════════════════════════════════════ */
async function fetchGoals() {
  try {
    const res = await apiFetch('/auth/goals/');
    if (!res.ok) return;
    const goals = await res.json();
    renderGoals(goals);
  } catch (err) {
    if (err.message !== 'Unauthorized') console.error(err);
  }
}

function renderGoals(goals) {
  const container = qs('#goalsList');
  if (!goals.length) {
    container.innerHTML = `<div class="empty" style="grid-column:1/-1;">
      <div class="empty-icon">🎯</div>
      <div class="empty-title">No goals yet</div>
      <div class="empty-desc">Click "New Goal" to set a productivity objective and track progress.</div>
    </div>`;
    return;
  }

  container.innerHTML = goals.map(g => {
    const pct = g.target_focus_hours > 0
      ? Math.min(100, Math.round((g.current_focus_hours / g.target_focus_hours) * 100))
      : 0;
    return `
      <div class="goal-card">
        <div class="goal-card-header">
          <div>
            <div class="goal-name">${htmlEsc(g.title)}</div>
            <div class="goal-desc">${htmlEsc(g.description || 'Focus preservation objective')}</div>
          </div>
          <span class="badge ${pct >= 100 ? 'badge-productive' : 'badge-info'}">${pct}%</span>
        </div>
        <div class="goal-progress">
          <div class="goal-bar-wrap">
            <div class="goal-bar" style="width:${pct}%"></div>
          </div>
          <div class="goal-meta">
            <span>${g.current_focus_hours}h of ${g.target_focus_hours}h completed</span>
            ${g.target_date ? `<span>Due: ${g.target_date}</span>` : ''}
          </div>
        </div>
        <div class="goal-actions">
          <button class="btn btn-ghost btn-sm btn-danger" onclick="deleteGoal(${g.id})">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

qs('#addGoalBtn').addEventListener('click', async () => {
  const title = prompt('Goal title (e.g. "Complete ML Project"):');
  if (!title?.trim()) return;
  const hours = parseFloat(prompt('Target focus hours:', '10') || '10') || 10;
  try {
    const res = await apiFetch('/auth/goals/', {
      method: 'POST',
      body: JSON.stringify({ title: title.trim(), target_focus_hours: hours, status: 'ACTIVE' })
    });
    if (res.ok) { toast('Goal created', 'success'); fetchGoals(); }
  } catch (e) { console.error(e); }
});

async function deleteGoal(id) {
  if (!confirm('Delete this goal?')) return;
  try {
    await apiFetch(`/auth/goals/${id}/`, { method: 'DELETE' });
    toast('Goal deleted');
    fetchGoals();
  } catch (e) { console.error(e); }
}

/* ═══════════════════════════════════════════════════════
   PROFILE CRUD
   ═══════════════════════════════════════════════════════ */
async function fetchProfile() {
  try {
    const res = await apiFetch('/auth/profile/');
    if (!res.ok) return;
    const p = await res.json();
    qs('#profOccupation').value = p.occupation || '';
    qs('#profTarget').value = p.daily_focus_goal_hours || 6;
  } catch (e) { console.error(e); }
}

qs('#saveProfileBtn').addEventListener('click', async () => {
  try {
    const res = await apiFetch('/auth/profile/', {
      method: 'PATCH',
      body: JSON.stringify({
        occupation: val('profOccupation'),
        daily_focus_goal_hours: parseFloat(val('profTarget')) || 6
      })
    });
    const msgEl = qs('#profileMsg');
    if (res.ok) {
      msgEl.textContent = '✓ Profile saved successfully.';
      msgEl.className = 'form-hint form-success';
      toast('Profile saved', 'success');
    } else {
      msgEl.textContent = 'Failed to save. Please try again.';
      msgEl.className = 'form-hint form-error';
    }
    setTimeout(() => { msgEl.textContent = ''; }, 4000);
  } catch (e) { console.error(e); }
});

/* ═══════════════════════════════════════════════════════
   AI ATTENTION ANALYSIS REPORT MODAL
   ═══════════════════════════════════════════════════════ */
function openAIReportModal(insightData, dashboardData, isLoading = false) {
  const modal = qs('#aiReportModal');
  if (!modal) return;
  modal.style.display = 'flex';

  const d = dashboardData || state.lastDashboardData || {};
  const ins = insightData || d.ai_insight || {};

  if (isLoading) {
    qs('#aiModalVerdictBadge').textContent = 'ANALYZING…';
    qs('#aiModalVerdictBadge').className = 'badge badge-neutral';
    qs('#aiModalScoreDisplay').textContent = 'Computing…';
    qs('#aiModalVerdictReason').textContent = 'Analyzing your daily activity, browsing patterns, and focus habits…';
    qs('#aiModalNarrative').textContent = 'Please wait while FocusGuard AI evaluates your focus sessions and activity…';
    return;
  }

  const prodS = d.productive_secs ?? Math.round((d.productive_hours || 0) * 3600);
  const distS = d.distracted_secs ?? Math.round((d.distracted_hours || 0) * 3600);
  const prodFormatted = d.productive_formatted || formatDuration(prodS);
  const distFormatted = d.distracted_formatted || formatDuration(distS);

  const pScore = Math.round(d.productivity_score ?? (distS === 0 ? 100 : Math.round((prodS / (prodS + distS)) * 100)));
  const fScore = Math.round(d.focus_score ?? pScore);
  const isProd = distS === 0 || pScore >= 55.0;

  // Verdict Banner
  const verdictCard = qs('#aiModalVerdictCard');
  const verdictBadge = qs('#aiModalVerdictBadge');
  const scoreDisplay = qs('#aiModalScoreDisplay');
  const reason = qs('#aiModalVerdictReason');

  if (verdictCard) {
    verdictCard.style.border = `1.5px solid ${isProd ? 'var(--color-success)' : 'var(--color-danger)'}`;
    verdictCard.style.background = isProd ? 'var(--color-success-bg)' : 'var(--color-danger-bg)';
  }
  if (verdictBadge) {
    verdictBadge.textContent = isProd ? '🟢 PRODUCTIVE' : '🔴 HIGH DISTRACTIONS';
    verdictBadge.className = `badge ${isProd ? 'badge-productive' : 'badge-danger'}`;
  }
  if (scoreDisplay) scoreDisplay.textContent = `Productivity: ${pScore}%`;
  if (reason) {
    if (prodS === 0 && distS === 0) {
      reason.textContent = 'No activity recorded yet today. Click "Start Session" to begin tracking your deep work and attention focus in real time.';
    } else {
      reason.textContent = isProd
        ? `Great focus today! You dedicated ${prodFormatted} to productive tasks with minimal distractions.`
        : `Frequent distractions detected. You spent ${distFormatted} on non-work apps and websites.`;
    }
  }

  // Diagnostics Chips
  qs('#aiModalProdTime').textContent = prodFormatted;
  qs('#aiModalDistTime').textContent = distFormatted;
  qs('#aiModalSwitches').textContent = d.total_switches || 0;
  qs('#aiModalFocusIndex').textContent = `${fScore}/100`;

  // Distractors list
  const distWrap = qs('#aiModalDistractorWrap');
  const distList = qs('#aiModalDistractorsList');
  const distractors = ins.top_distractors || [];
  if (distractors.length > 0 && distWrap && distList) {
    distWrap.style.display = 'block';
    distList.innerHTML = distractors.map(x => `
      <span class="badge badge-danger" style="font-size:12px; padding:6px 12px;">
        ${htmlEsc(x.name)} (${x.duration_mins}m)
      </span>
    `).join('');
  } else if (distWrap) {
    distWrap.style.display = 'none';
  }

  // Narrative
  const narrative = ins.insights_text || 'Focus analysis generated based on your activity and session records.';
  qs('#aiModalNarrative').textContent = narrative;

  // Recommendations
  const recsGrid = qs('#aiModalRecsGrid');
  const recs = ins.recommendations || [];
  if (recsGrid) {
    recsGrid.innerHTML = recs.map(r => `
      <div style="background:var(--surface-2); padding:12px 14px; border-radius:var(--r-sm); border-left:3px solid var(--brand-500);">
        <div style="font-weight:700; font-size:13px; color:var(--text-900); margin-bottom:3px;">💡 ${htmlEsc(r.title || '')}</div>
        <div style="font-size:12.5px; color:var(--text-600); line-height:1.5;">${htmlEsc(r.detail || r.text || '')}</div>
      </div>
    `).join('');
  }

  qs('#aiModalTimestamp').textContent = ins.generated_at
    ? `Generated at ${new Date(ins.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Real-time synthesis';
}

function closeAIReportModal() {
  const modal = qs('#aiReportModal');
  if (modal) modal.style.display = 'none';
}

qs('#closeAiModalBtn')?.addEventListener('click', closeAIReportModal);
qs('#aiModalOkBtn')?.addEventListener('click', closeAIReportModal);
qs('.insight-card')?.addEventListener('click', () => openAIReportModal(null, state.lastDashboardData, false));

// AI Analysis Button handler
qs('#aiAnalysisBtn')?.addEventListener('click', async () => {
  const btn = qs('#aiAnalysisBtn');
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Analyzing…`;
  btn.disabled = true;

  // Immediately display modal in loading state
  openAIReportModal(null, state.lastDashboardData, true);

  try {
    const res = await apiFetch('/ai/generate-insight/', { method: 'POST' });
    if (res.ok) {
      const insight = await res.json();
      await fetchDashboard();
      openAIReportModal(insight, state.lastDashboardData, false);
      toast('AI Analysis complete!', 'success');
    } else {
      await fetchDashboard();
      openAIReportModal(null, state.lastDashboardData, false);
    }
  } catch (e) {
    console.error('AI error:', e);
    await fetchDashboard();
    openAIReportModal(null, state.lastDashboardData, false);
  } finally {
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>AI Analysis`;
    btn.disabled = false;
  }
});

/* ═══════════════════════════════════════════════════════
   DATE-WISE REPORT GENERATION & DATA DELETION
   ═══════════════════════════════════════════════════════ */
async function loadDateReport(dateStr) {
  const placeholder = qs('#dateReportPlaceholder');
  const content = qs('#dateReportContent');
  if (!dateStr) return;

  try {
    const res = await apiFetch(`/dashboard/report/?date=${dateStr}`);
    if (!res.ok) {
      toast('Could not load report for selected date', 'danger');
      return;
    }
    const d = await res.json();

    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = 'flex';

    // Verdict Banner
    const isProd = d.verdict === 'PRODUCTIVE';
    const isDist = d.verdict === 'DISTRACTED';
    const banner = qs('#dateReportVerdictBanner');
    const badge = qs('#dateReportVerdictBadge');

    if (banner) {
      banner.style.border = `1.5px solid ${isProd ? 'var(--color-success)' : isDist ? 'var(--color-danger)' : 'var(--border)'}`;
      banner.style.background = isProd ? 'var(--color-success-bg)' : isDist ? 'var(--color-danger-bg)' : 'var(--surface-1)';
    }
    if (badge) {
      badge.textContent = d.verdict_badge || d.verdict;
      badge.className = `badge ${isProd ? 'badge-productive' : isDist ? 'badge-danger' : 'badge-neutral'}`;
    }
    qs('#dateReportDateLabel').textContent = `Activity Report for ${d.date}`;
    qs('#dateReportVerdictReason').textContent = d.verdict_reason || '';

    // 4 Metrics
    qs('#dateReportProdHours').textContent = d.productive_formatted || formatDuration(d.productive_secs ?? Math.round((d.productive_hours || 0) * 3600));
    qs('#dateReportDistHours').textContent = d.distracted_formatted || formatDuration(d.distracted_secs ?? Math.round((d.distracted_hours || 0) * 3600));
    qs('#dateReportSwitches').textContent = d.total_switches;
    qs('#dateReportScore').textContent = `${Math.round(d.productivity_score)}%`;

    // Separate Sessions on this date
    const sessionList = qs('#dateReportSessionsList');
    const sessionBadge = qs('#dateReportSessionCount');
    const sessions = d.sessions || [];
    if (sessionBadge) sessionBadge.textContent = `${sessions.length} Session${sessions.length !== 1 ? 's' : ''}`;

    if (sessionList) {
      if (sessions.length === 0) {
        sessionList.innerHTML = `<div style="font-size:12px; color:var(--text-400); padding:8px 0;">No focus sessions logged on this date.</div>`;
      } else {
        sessionList.innerHTML = sessions.map((s, idx) => {
          const startTime = new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const endTime = s.end_time ? new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active';
          const pScore = Math.round(s.productivity_score ?? 100);
          return `
            <div style="padding:10px 14px; background:var(--surface-2); border-radius:var(--r-sm); display:flex; justify-content:space-between; align-items:center; font-size:12px;">
              <div>
                <strong>Session #${idx + 1}</strong>: ${htmlEsc(s.session_type || 'Deep Work')} · 
                <span style="color:var(--text-500);">${startTime} – ${endTime} (${formatDuration((s.actual_duration_mins || 0) * 60)})</span>
              </div>
              <div style="display:flex; gap:12px; align-items:center;">
                <span>${s.switches_count || 0} switches</span>
                <span class="badge ${pScore >= 70 ? 'badge-productive' : pScore >= 40 ? 'badge-neutral' : 'badge-danger'}">${pScore}% Productive</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Top Apps
    const appsList = qs('#dateReportAppsList');
    if (appsList) {
      const apps = d.top_apps || [];
      if (apps.length === 0) {
        appsList.innerHTML = `<div style="font-size:12px; color:var(--text-400);">No desktop app activity on this date.</div>`;
      } else {
        appsList.innerHTML = apps.map(a => `
          <div style="display:flex; justify-content:space-between; font-size:12px; padding:6px 10px; background:var(--surface-2); border-radius:var(--r-xs); margin-bottom:4px;">
            <span>${htmlEsc(a.app_name)}</span>
            <span style="font-weight:600;">${formatDuration(a.total_secs)}</span>
          </div>
        `).join('');
      }
    }

    // Top Sites
    const sitesList = qs('#dateReportSitesList');
    if (sitesList) {
      const sites = d.top_sites || [];
      if (sites.length === 0) {
        sitesList.innerHTML = `<div style="font-size:12px; color:var(--text-400);">No browser activity on this date.</div>`;
      } else {
        sitesList.innerHTML = sites.map(s => `
          <div style="display:flex; justify-content:space-between; font-size:12px; padding:6px 10px; background:var(--surface-2); border-radius:var(--r-xs); margin-bottom:4px;">
            <span>${htmlEsc(s.domain)}</span>
            <span style="font-weight:600;">${formatDuration(s.total_secs)}</span>
          </div>
        `).join('');
      }
    }

  } catch (e) {
    console.error('Error loading date report:', e);
    toast('Error generating date report', 'danger');
  }
}

async function deleteDateData(dateStr) {
  if (!dateStr) return;
  const confirmed = confirm(`⚠️ Are you sure you want to permanently delete all activity and focus sessions recorded on ${dateStr}?\n\nThis action cannot be undone.`);
  if (!confirmed) return;

  try {
    const res = await apiFetch(`/dashboard/report/?date=${dateStr}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      toast(`Deleted ${data.deleted?.total || 0} records for ${dateStr}`, 'success');
      await loadDateReport(dateStr);
      await fetchDashboard();
    } else {
      toast('Failed to delete data for date', 'danger');
    }
  } catch (e) {
    console.error('Error deleting date data:', e);
    toast('Error deleting date data', 'danger');
  }
}

// Wire Date Report buttons
const reportDateInput = qs('#reportDateInput');
if (reportDateInput) {
  reportDateInput.value = new Date().toISOString().slice(0, 10);
}

qs('#btnGenDateReport')?.addEventListener('click', () => {
  const dateVal = qs('#reportDateInput')?.value;
  if (!dateVal) { toast('Please choose a date', 'danger'); return; }
  loadDateReport(dateVal);
});

qs('#btnDeleteDateData')?.addEventListener('click', () => {
  const dateVal = qs('#reportDateInput')?.value;
  if (!dateVal) { toast('Please choose a date to delete', 'danger'); return; }
  deleteDateData(dateVal);
});

/* ═══════════════════════════════════════════════════════
   TODAY'S SEPARATE FOCUS SESSIONS RENDERER
   ═══════════════════════════════════════════════════════ */
function renderTodayFocusSessions(sessions) {
  const container = qs('#focusTodaySessionsList');
  const countBadge = qs('#focusSessionsCountBadge');
  if (!container) return;

  const countStr = `${sessions.length} Session${sessions.length !== 1 ? 's' : ''}`;
  if (countBadge && countBadge.textContent !== countStr) {
    countBadge.textContent = countStr;
  }

  const json = JSON.stringify(sessions);
  if (container.dataset.lastJson === json) return;
  container.dataset.lastJson = json;

  if (!sessions || sessions.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">⏱️</div>
        <div class="empty-title">No completed sessions yet today</div>
        <div class="empty-desc">Click "Start Session" above to begin your first deep work block.</div>
      </div>`;
    return;
  }

  container.innerHTML = sessions.map((s, idx) => {
    const sNum = idx + 1;
    const startTime = new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endTime = s.end_time ? new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'In progress';
    const score = Math.round(s.productivity_score ?? 100);
    const badgeClass = score >= 70 ? 'badge-productive' : score >= 40 ? 'badge-neutral' : 'badge-danger';
    const isCompleted = s.status === 'COMPLETED';

    return `
      <div class="card" style="padding:16px 20px; border:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; background:var(--surface-0); border-radius:var(--r-md);">
        <div style="display:flex; align-items:center; gap:14px;">
          <div style="width:40px; height:40px; border-radius:var(--r-md); background:var(--surface-2); display:flex; align-items:center; justify-content:center; font-weight:800; color:var(--brand-600); font-size:15px;">
            #${sNum}
          </div>
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-weight:700; font-size:14px; color:var(--text-900);">${htmlEsc(s.session_type || 'Deep Work')}</span>
              <span class="badge ${badgeClass}" style="font-size:10px;">${score}% PRODUCTIVE</span>
              <span class="badge ${isCompleted ? 'badge-productive' : 'badge-neutral'}" style="font-size:10px;">${s.status}</span>
            </div>
            <div style="font-size:12px; color:var(--text-500); margin-top:3px;">
              ⏱️ ${startTime} – ${endTime} · <strong>${formatDuration((s.actual_duration_mins || 0) * 60)}</strong>
            </div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:16px; font-size:12px;">
          <div>
            <div style="color:var(--text-400); font-size:10px; text-transform:uppercase;">Productive</div>
            <div style="font-weight:700; color:var(--color-success);">${formatDuration(s.productive_secs)}</div>
          </div>
          <div>
            <div style="color:var(--text-400); font-size:10px; text-transform:uppercase;">Distracted</div>
            <div style="font-weight:700; color:var(--color-danger);">${formatDuration(s.distracted_secs)}</div>
          </div>
          <div>
            <div style="color:var(--text-400); font-size:10px; text-transform:uppercase;">Switches</div>
            <div style="font-weight:700; color:var(--brand-600);">${s.switches_count || 0}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   DASHBOARD & TAB SESSION CONTROLLER (NO TIMERS)
   ═══════════════════════════════════════════════════════ */
let dashTimerInterval = null;

function updateDashSessionUI(activeSession) {
  const card = qs('#dashSessionCard');
  const badge = qs('#dashSessionBadge');
  const title = qs('#dashSessionTitle');
  const meta = qs('#dashSessionMeta');
  const elapsedDisplay = qs('#dashElapsedDisplay');
  const startBtn = qs('#dashStartSessionBtn');
  const endBtn = qs('#dashEndSessionBtn');

  // Also sync tab-focus controls if present
  const focusBadge = qs('#focusSessionStatusBadge');
  const focusDisplay = qs('#timerDisplay');
  const focusLabel = qs('#timerLabel');
  const startTimerBtn = qs('#startTimerBtn');
  const endTimerBtn = qs('#endTimerBtn');

  if (!card) return;

  if (activeSession && activeSession.id) {
    state.activeSessionId = activeSession.id;
    const startTime = new Date(activeSession.start_time).getTime();
    state.activeSessionStartTime = startTime;

    if (badge && badge.textContent !== 'SESSION ACTIVE') {
      badge.textContent = 'SESSION ACTIVE';
      badge.className = 'badge badge-productive';
    }
    const expectedTitle = `Active Session: <span style="color:var(--brand-600);">${htmlEsc(activeSession.session_type || 'Deep Work')}</span>`;
    if (title && title.innerHTML !== expectedTitle) {
      title.innerHTML = expectedTitle;
    }
    
    if (elapsedDisplay) elapsedDisplay.style.display = 'inline-block';
    if (startBtn) startBtn.style.display = 'none';
    if (endBtn) endBtn.style.display = 'inline-flex';

    if (focusBadge && focusBadge.textContent !== 'SESSION ACTIVE') {
      focusBadge.textContent = 'SESSION ACTIVE';
      focusBadge.className = 'badge badge-productive';
    }
    if (focusLabel && focusLabel.textContent !== 'Session actively tracking · No timer limits') {
      focusLabel.textContent = 'Session actively tracking · No timer limits';
    }
    if (startTimerBtn) startTimerBtn.style.display = 'none';
    if (endTimerBtn) endTimerBtn.style.display = 'inline-flex';

    if (!dashTimerInterval) {
      function tick() {
        // Enforce button visibility during active session
        const sBtn = qs('#dashStartSessionBtn');
        const eBtn = qs('#dashEndSessionBtn');
        if (sBtn && sBtn.style.display !== 'none') sBtn.style.display = 'none';
        if (eBtn && eBtn.style.display !== 'inline-flex') eBtn.style.display = 'inline-flex';

        const start = state.activeSessionStartTime || startTime;
        const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
        const elapsedMins = Math.floor(elapsed / 60);
        checkBreakReminder(elapsedMins);

        const hours = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
        const s = (elapsed % 60).toString().padStart(2, '0');
        const timeStr = hours > 0 ? `${hours}:${m}:${s}` : `${m}:${s}`;

        const elapsedDisp = qs('#dashElapsedDisplay');
        if (elapsedDisp) {
          const str = `Elapsed: ${timeStr}`;
          if (elapsedDisp.textContent !== str) elapsedDisp.textContent = str;
        }
        const focusDisp = qs('#timerDisplay');
        if (focusDisp && focusDisp.textContent !== timeStr) {
          focusDisp.textContent = timeStr;
        }

        // Real-time live seconds increment on the 3 main cards!
        const currentTier = state.liveActiveApp?.productivity_label || 'PRODUCTIVE';
        if (currentTier === 'DISTRACTING') {
          state.liveDistSecs = (state.liveDistSecs || 0) + 1;
          checkAndPlayDistractionChime(state.liveActiveApp?.app_name || 'Distraction');
        } else if (currentTier === 'NEUTRAL') {
          // NEUTRAL time (WhatsApp, Spotify, File Explorer) = NOT productive
          state.liveNeutSecs = (state.liveNeutSecs || 0) + 1;
        } else {
          // PRODUCTIVE: actual focused work
          state.liveProdSecs = (state.liveProdSecs || 0) + 1;
        }

        const prodFormatted = formatDuration(state.liveProdSecs);
        const distFormatted = formatDuration(state.liveDistSecs);
        // Full denominator includes neutral so score accurately reflects focus quality
        const liveTot = state.liveProdSecs + state.liveDistSecs + (state.liveNeutSecs || 0);
        const rawLivePct = liveTot > 0 ? Math.round((state.liveProdSecs / liveTot) * 100) : 100;
        const sw = state.liveSwitches || (state.liveSession?.switches) || 0;
        const swPenalty = Math.min(30, Math.round(sw * 1.5));
        const liveScore = Math.max(0, rawLivePct - swPenalty);

        // In-place updates with zero DOM thrash
        setEl('prodVal', prodFormatted);
        setEl('distVal', distFormatted);
        setEl('scoreVal', `${liveScore}%`);
        const lbl = liveScore >= 70 ? 'High Focus' : liveScore >= 40 ? 'Moderate' : 'Needs Focus';
        setEl('scoreMeta', sw > 0 ? `${rawLivePct}% productive · −${swPenalty}pts (${sw} switches) · ${lbl}` : `${rawLivePct}% productive · ${lbl}`);

        const metaEl = qs('#dashSessionMeta');
        if (metaEl) {
          const startFormatted = new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const newMeta = `Session in progress · Started at ${startFormatted} · ${Math.floor(elapsed / 60)}m elapsed · Current session: ${sw} switches · ${liveScore}% productive`;
          if (metaEl.textContent !== newMeta) metaEl.textContent = newMeta;
        }
      }
      tick();
      dashTimerInterval = setInterval(tick, 1000);
    }

  } else {
    if (dashTimerInterval) { clearInterval(dashTimerInterval); dashTimerInterval = null; }
    state.activeSessionId = null;
    state.activeSessionStartTime = null;
    if (badge && badge.textContent !== 'IDLE') { badge.textContent = 'IDLE'; badge.className = 'badge badge-neutral'; }
    if (title && title.textContent !== 'No Active Session') title.textContent = 'No Active Session';
    const idleMeta = 'Start a session to actively shield your attention, track context switches, and record your productivity score.';
    if (meta && meta.textContent !== idleMeta) meta.textContent = idleMeta;
    if (elapsedDisplay) elapsedDisplay.style.display = 'none';
    if (startBtn) startBtn.style.display = 'inline-flex';
    if (endBtn) endBtn.style.display = 'none';

    if (focusBadge && focusBadge.textContent !== 'IDLE') { focusBadge.textContent = 'IDLE'; focusBadge.className = 'badge badge-neutral'; }
    if (focusDisplay && focusDisplay.textContent !== '00:00') focusDisplay.textContent = '00:00';
    if (focusLabel && focusLabel.textContent !== 'Ready to start session') focusLabel.textContent = 'Ready to start session';
    if (startTimerBtn) startTimerBtn.style.display = 'inline-flex';
    if (endTimerBtn) endTimerBtn.style.display = 'none';

    updateLiveVisionUI({ is_active: false });
  }
}

// Single Button click handlers for Start Session and Stop Session
qs('#dashStartSessionBtn')?.addEventListener('click', startFocusSession);
qs('#dashEndSessionBtn')?.addEventListener('click', endFocusSession);

/* ═══════════════════════════════════════════════════════
   LIVE POLLING
   ═══════════════════════════════════════════════════════ */
function startPoll() {
  stopPoll();
  state.pollTimer = setInterval(() => {
    updateCurrentFocusDisplay();
    const tab = state.activeTab;
    if (tab === 'dashboard') fetchDashboard();
    else if (tab === 'switches') fetchSwitches();
    else if (tab === 'telemetry') fetchTelemetry();
    else if (tab === 'system') fetchSystemData();
  }, POLL_MS);
}


function stopPoll() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

function updateLastUpdated() {
  const el = qs('#lastUpdated');
  if (el) {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (el.textContent !== t) el.textContent = t;
  }
}

/* ═══════════════════════════════════════════════════════
   SOUND NOTIFICATIONS (Feature 2: Web Audio API)
   ═══════════════════════════════════════════════════════ */
let audioCtx = null;
let isSoundMuted = localStorage.getItem('fg_sound_muted') === 'true';

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playChime(type = 'start') {
  if (isSoundMuted) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    
    if (type === 'start') {
      // Uplifting ascending major triad (C5 -> E5 -> G5)
      const freqs = [523.25, 659.25, 783.99];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);
        gain.gain.setValueAtTime(0, now + idx * 0.12);
        gain.gain.linearRampToValueAtTime(0.18, now + idx * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.12 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.36);
      });
    } else if (type === 'end') {
      // Celebratory completion chime (G4 -> C5 -> E5 -> G5)
      const freqs = [392.00, 523.25, 659.25, 783.99];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.14);
        gain.gain.setValueAtTime(0, now + idx * 0.14);
        gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.14 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.14);
        osc.stop(now + idx * 0.14 + 0.52);
      });
    } else if (type === 'distraction') {
      // Soft polite distraction warning (two descending low notes)
      const freqs = [440, 349.23];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.15);
        gain.gain.setValueAtTime(0, now + idx * 0.15);
        gain.gain.linearRampToValueAtTime(0.14, now + idx * 0.15 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.15 + 0.28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.15);
        osc.stop(now + idx * 0.15 + 0.3);
      });
    } else if (type === 'break') {
      // Calming resonant meditation bell chime (warm 432Hz with harmonic)
      [432, 864].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = idx === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(idx === 0 ? 0.22 : 0.08, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.85);
      });
    }
  } catch (e) {
    console.debug('Web Audio error or waiting for gesture:', e);
  }
}

function updateSoundToggleUI() {
  const iconOn = qs('#soundIconOn');
  const iconOff = qs('#soundIconOff');
  const btn = qs('#soundToggleBtn');
  if (iconOn && iconOff) {
    if (isSoundMuted) {
      iconOn.style.display = 'none';
      iconOff.style.display = 'block';
      if (btn) btn.title = 'Audio Chimes: Muted (Click to un-mute)';
    } else {
      iconOn.style.display = 'block';
      iconOff.style.display = 'none';
      if (btn) btn.title = 'Audio Chimes: Active (Click to mute)';
    }
  }
}

function toggleSoundMute() {
  isSoundMuted = !isSoundMuted;
  localStorage.setItem('fg_sound_muted', isSoundMuted ? 'true' : 'false');
  updateSoundToggleUI();
  if (!isSoundMuted) {
    playChime('start');
    toast('🔊 Audio chimes enabled', 'info');
  } else {
    toast('🔇 Audio chimes muted', 'info');
  }
}

let lastDistractionChimeTime = 0;
function checkAndPlayDistractionChime(label, app, tab, durSecs) {
  const now = Date.now();
  if (now - lastDistractionChimeTime > 25000) {
    lastDistractionChimeTime = now;
    playChime('distraction');
    const curGoal = state.currentGoal || 'Coding';
    const appInfo = app || label || 'Google Chrome';
    const tabInfo = tab ? ` · Tab: ${tab}` : '';
    const durInfo = durSecs ? ` · ${formatDuration(durSecs)}` : '';
    toast(`⚠️ FOCUS ALERT [${curGoal}]: ${appInfo}${tabInfo}${durInfo} is marked as a distraction`, 'warning');
  }
}


/* ═══════════════════════════════════════════════════════
   BREAK & HYDRATION REMINDERS (Feature 5)
   ═══════════════════════════════════════════════════════ */
let lastBreakReminderMinute = 0;
let breakCountdownInterval = null;

function checkBreakReminder(elapsedMins) {
  if (elapsedMins >= 50 && (elapsedMins - lastBreakReminderMinute) >= 50) {
    lastBreakReminderMinute = Math.floor(elapsedMins / 50) * 50;
    showBreakReminderModal(elapsedMins);
  }
}

function showBreakReminderModal(elapsedMins) {
  const modal = qs('#breakReminderModal');
  if (!modal) return;
  setEl('breakMinsElapsed', `${elapsedMins} minutes`);
  modal.style.display = 'flex';
  playChime('break');

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  } else if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('FocusGuard AI — Rest & Refresh Reminder', {
        body: `You've achieved ${elapsedMins} minutes of continuous deep work! Rest your eyes and hydrate.`,
        icon: '/static/favicon.ico'
      });
    } catch (e) {}
  }
}

function closeBreakReminderModal() {
  const modal = qs('#breakReminderModal');
  if (modal) modal.style.display = 'none';
  if (breakCountdownInterval) {
    clearInterval(breakCountdownInterval);
    breakCountdownInterval = null;
  }
  setEl('breakCountdownClock', '05:00');
  const btn = qs('#startBreakTimerBtn');
  if (btn) btn.textContent = 'Start 5-Minute Rest Timer';
}

function startBreakCountdown(totalSeconds = 300) {
  if (breakCountdownInterval) clearInterval(breakCountdownInterval);
  let remaining = totalSeconds;
  const btn = qs('#startBreakTimerBtn');
  if (btn) btn.textContent = 'Rest Timer Running…';

  function updateClock() {
    const m = Math.floor(remaining / 60).toString().padStart(2, '0');
    const s = (remaining % 60).toString().padStart(2, '0');
    setEl('breakCountdownClock', `${m}:${s}`);
    if (remaining <= 0) {
      clearInterval(breakCountdownInterval);
      breakCountdownInterval = null;
      playChime('start');
      toast('🌟 Break complete! Ready to dive back into deep focus.', 'success');
      closeBreakReminderModal();
    }
    remaining--;
  }

  updateClock();
  breakCountdownInterval = setInterval(updateClock, 1000);
}

/* ═══════════════════════════════════════════════════════
   WEEKLY & MONTHLY TRENDS & CSV EXPORT (Feature 3)
   ═══════════════════════════════════════════════════════ */
let chartTrends = null;
let currentTrendsDays = 7;

async function loadTrends(days = 7) {
  currentTrendsDays = days;
  
  // Update button visual states
  const b7 = qs('#btnTrends7');
  const b30 = qs('#btnTrends30');
  if (b7 && b30) {
    if (days === 7) {
      b7.style.background = 'var(--surface-0)';
      b7.style.borderColor = 'var(--brand-200)';
      b7.style.color = 'var(--brand-600)';
      b7.style.fontWeight = '700';

      b30.style.background = 'transparent';
      b30.style.borderColor = 'transparent';
      b30.style.color = 'var(--text-600)';
      b30.style.fontWeight = '600';
    } else {
      b30.style.background = 'var(--surface-0)';
      b30.style.borderColor = 'var(--brand-200)';
      b30.style.color = 'var(--brand-600)';
      b30.style.fontWeight = '700';

      b7.style.background = 'transparent';
      b7.style.borderColor = 'transparent';
      b7.style.color = 'var(--text-600)';
      b7.style.fontWeight = '600';
    }
  }

  try {
    const res = await apiFetch(`/dashboard/trends/?days=${days}`);
    if (!res.ok) return;
    const data = await res.json();
    renderTrends(data);
  } catch (err) {
    console.error('Failed to load trends:', err);
  }
}

function renderTrends(data) {
  const points = data.daily_points || [];
  
  // Update summary badges
  const avgScore = data.avg_productivity_score ?? data.average_score;
  setEl('trendsAvgScore', (avgScore !== null && avgScore !== undefined) ? `${avgScore}%` : '—');

  const delta = data.delta_vs_prior ?? 0;
  const deltaBadge = qs('#trendsDeltaBadge');
  if (deltaBadge) {
    if (avgScore === null || avgScore === undefined) {
      deltaBadge.textContent = 'No data';
      deltaBadge.className = 'badge badge-neutral';
    } else if (delta > 0) {
      deltaBadge.textContent = `+${delta}% vs prior`;
      deltaBadge.className = 'badge badge-productive';
    } else if (delta < 0) {
      deltaBadge.textContent = `${delta}% vs prior`;
      deltaBadge.className = 'badge badge-danger';
    } else {
      deltaBadge.textContent = `Equal vs prior`;
      deltaBadge.className = 'badge badge-neutral';
    }
  }

  const totalProdSecs = data.total_productive_secs ?? points.reduce((acc, p) => acc + (p.productive_secs ?? Math.round((p.productive_hours || 0) * 3600)), 0);
  const totalDistSecs = data.total_distracted_secs ?? points.reduce((acc, p) => acc + (p.distracted_secs ?? Math.round((p.distracted_hours || 0) * 3600)), 0);
  const totalSwitches = data.total_switches ?? points.reduce((acc, p) => acc + (p.switches ?? p.switches_count ?? 0), 0);

  setEl('trendsTotalProd', formatDuration(totalProdSecs));
  setEl('trendsTotalDist', formatDuration(totalDistSecs));
  setEl('trendsTotalSwitches', totalSwitches.toLocaleString());

  // Render Chart.js
  const canvas = qs('#trendsChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const labels = points.map(p => {
    const d = new Date(p.date + 'T00:00:00');
    return d.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });
  });

  const prodHours = points.map(p => p.productive_hours ?? +( ((p.productive_secs || 0) / 3600).toFixed(2) ));
  const distHours = points.map(p => p.distracted_hours ?? +( ((p.distracted_secs || 0) / 3600).toFixed(2) ));
  const scoreData = points.map(p => p.productivity_score);

  if (chartTrends) {
    chartTrends.destroy();
    chartTrends = null;
  }

  const ctx = canvas.getContext('2d');
  chartTrends = new Chart(ctx, {
    data: {
      labels: labels,
      datasets: [
        {
          type: 'line',
          label: 'Productivity Score (%)',
          data: scoreData,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#6366f1',
          yAxisID: 'yScore',
          tension: 0.3,
          spanGaps: true
        },
        {
          type: 'bar',
          label: 'Productive Hours',
          data: prodHours,
          backgroundColor: 'rgba(16, 185, 129, 0.85)',
          borderRadius: 6,
          barPercentage: 0.6,
          yAxisID: 'yHours'
        },
        {
          type: 'bar',
          label: 'Distracted Hours',
          data: distHours,
          backgroundColor: 'rgba(239, 68, 68, 0.85)',
          borderRadius: 6,
          barPercentage: 0.6,
          yAxisID: 'yHours'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { boxWidth: 12, font: { family: 'Inter', size: 11, weight: '600' } }
        },
        tooltip: {
          padding: 10,
          boxPadding: 4,
          usePointStyle: true,
          callbacks: {
            label: (ctx) => {
              if (ctx.parsed.y === null || ctx.parsed.y === undefined) return null;
              if (ctx.dataset.yAxisID === 'yScore') {
                return ` Score: ${ctx.parsed.y}%`;
              }
              return ` ${ctx.dataset.label}: ${ctx.parsed.y} hrs`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Inter', size: 11 } }
        },
        yHours: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          title: { display: true, text: 'Hours', font: { family: 'Inter', size: 11, weight: '600' } },
          grid: { color: 'rgba(226, 232, 240, 0.6)' }
        },
        yScore: {
          type: 'linear',
          position: 'right',
          min: 0,
          max: 100,
          title: { display: true, text: 'Score %', font: { family: 'Inter', size: 11, weight: '600' } },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function exportTrendsCSV(days = 7) {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(toDate.getDate() - (days - 1));

  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);

  apiFetch(`/dashboard/export/csv/?date_from=${fromStr}&date_to=${toStr}`)
    .then(async (res) => {
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `focusguard_analytics_${fromStr}_to_${toStr}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('📥 Analytics CSV downloaded successfully!', 'success');
    })
    .catch((err) => {
      console.error('CSV export error:', err);
      toast('Failed to download CSV export', 'danger');
    });
}

// Wire Event Listeners for Sound, Break Reminders, and Trends
qs('#soundToggleBtn')?.addEventListener('click', toggleSoundMute);
qs('#btnTrends7')?.addEventListener('click', () => loadTrends(7));
qs('#btnTrends30')?.addEventListener('click', () => loadTrends(30));
qs('#btnExportCSV')?.addEventListener('click', () => exportTrendsCSV(currentTrendsDays || 7));
qs('#startBreakTimerBtn')?.addEventListener('click', () => startBreakCountdown(300));
qs('#dismissBreakBtn')?.addEventListener('click', closeBreakReminderModal);

/* ═══════════════════════════════════════════════════════
   BLOCKLIST MANAGER (Custom Apps & Websites)
   ═══════════════════════════════════════════════════════ */
let blocklistState = {
  activeTab: 'apps',
  apps: [],
  domains: []
};

const DEFAULT_BLOCKLIST_APPS = [
  'steam.exe', 'discord.exe', 'spotify.exe', 'netflix.exe',
  'epicgameslauncher.exe', 'riotclientux.exe', 'leagueclient.exe',
  'valorant.exe', 'csgo.exe', 'telegram.exe', 'whatsapp.exe', 'tiktok.exe'
];

const DEFAULT_BLOCKLIST_DOMAINS = [
  'youtube.com', 'twitter.com', 'x.com', 'reddit.com',
  'instagram.com', 'facebook.com', 'netflix.com', 'tiktok.com', 'twitch.tv'
];

async function loadBlocklist() {
  try {
    const res = await apiFetch('/focus/blocklist/');
    if (res.ok) {
      const data = await res.json();
      blocklistState.apps = data.blocked_apps || [...DEFAULT_BLOCKLIST_APPS];
      blocklistState.domains = data.blocked_domains || [...DEFAULT_BLOCKLIST_DOMAINS];
      renderBlocklistUI();
      return;
    }
  } catch (e) {}
  blocklistState.apps = [...DEFAULT_BLOCKLIST_APPS];
  blocklistState.domains = [...DEFAULT_BLOCKLIST_DOMAINS];
  renderBlocklistUI();
}

function renderBlocklistUI() {
  setEl('blockedAppsCount', blocklistState.apps.length);
  setEl('blockedDomainsCount', blocklistState.domains.length);

  const appsContainer = qs('#blockedAppsContainer');
  if (appsContainer) {
    if (blocklistState.apps.length === 0) {
      appsContainer.innerHTML = '<div style="font-size:12px; color:var(--text-400); padding:8px;">No desktop apps blocked.</div>';
    } else {
      appsContainer.innerHTML = blocklistState.apps.map((app, idx) => `
        <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-full); padding:4px 12px; display:inline-flex; align-items:center; gap:8px; font-size:12px; font-weight:600; color:var(--text-800);">
          <span>🖥️ ${htmlEsc(app)}</span>
          <button type="button" onclick="removeBlockedApp(${idx})" style="background:none; border:none; color:var(--color-danger); cursor:pointer; font-size:13px; padding:0; display:flex; align-items:center;" title="Unblock ${htmlEsc(app)}">✕</button>
        </div>
      `).join('');
    }
  }

  const domainsContainer = qs('#blockedDomainsContainer');
  if (domainsContainer) {
    if (blocklistState.domains.length === 0) {
      domainsContainer.innerHTML = '<div style="font-size:12px; color:var(--text-400); padding:8px;">No websites blocked.</div>';
    } else {
      domainsContainer.innerHTML = blocklistState.domains.map((dom, idx) => `
        <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-full); padding:4px 12px; display:inline-flex; align-items:center; gap:8px; font-size:12px; font-weight:600; color:var(--text-800);">
          <span>🌐 ${htmlEsc(dom)}</span>
          <button type="button" onclick="removeBlockedDomain(${idx})" style="background:none; border:none; color:var(--color-danger); cursor:pointer; font-size:13px; padding:0; display:flex; align-items:center;" title="Unblock ${htmlEsc(dom)}">✕</button>
        </div>
      `).join('');
    }
  }
}

function openBlocklistModal() {
  const modal = qs('#blocklistModal');
  if (modal) {
    modal.style.display = 'flex';
    loadBlocklist();
  }
}

function closeBlocklistModal() {
  const modal = qs('#blocklistModal');
  if (modal) modal.style.display = 'none';
}

function switchBlocklistTab(tab) {
  blocklistState.activeTab = tab;
  const btnApps = qs('#tabBtnBlockApps');
  const btnDomains = qs('#tabBtnBlockDomains');
  const paneApps = qs('#blocklistPaneApps');
  const paneDomains = qs('#blocklistPaneDomains');

  if (tab === 'apps') {
    if (btnApps) {
      btnApps.style.color = 'var(--brand-600)';
      btnApps.style.fontWeight = '700';
      btnApps.style.borderBottom = '2px solid var(--brand-600)';
    }
    if (btnDomains) {
      btnDomains.style.color = 'var(--text-500)';
      btnDomains.style.fontWeight = '600';
      btnDomains.style.borderBottom = '2px solid transparent';
    }
    if (paneApps) paneApps.style.display = 'flex';
    if (paneDomains) paneDomains.style.display = 'none';
  } else {
    if (btnDomains) {
      btnDomains.style.color = 'var(--brand-600)';
      btnDomains.style.fontWeight = '700';
      btnDomains.style.borderBottom = '2px solid var(--brand-600)';
    }
    if (btnApps) {
      btnApps.style.color = 'var(--text-500)';
      btnApps.style.fontWeight = '600';
      btnApps.style.borderBottom = '2px solid transparent';
    }
    if (paneApps) paneApps.style.display = 'none';
    if (paneDomains) paneDomains.style.display = 'flex';
  }
}

function addBlockedApp() {
  const input = qs('#newBlockedAppInput');
  let val = (input?.value || '').trim().toLowerCase();
  if (!val) return;
  if (!val.endsWith('.exe')) val = val + '.exe';
  if (!blocklistState.apps.includes(val)) {
    blocklistState.apps.push(val);
    renderBlocklistUI();
    toast(`Added ${val} to blocked apps`, 'info');
  } else {
    toast(`${val} is already in the blocked list`, 'warning');
  }
  if (input) input.value = '';
}

function removeBlockedApp(idx) {
  if (idx >= 0 && idx < blocklistState.apps.length) {
    const removed = blocklistState.apps.splice(idx, 1)[0];
    renderBlocklistUI();
    toast(`Removed ${removed} from blocked apps`, 'info');
  }
}

function addBlockedDomain() {
  const input = qs('#newBlockedDomainInput');
  let val = (input?.value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!val) return;
  if (!blocklistState.domains.includes(val)) {
    blocklistState.domains.push(val);
    renderBlocklistUI();
    toast(`Added ${val} to blocked websites`, 'info');
  } else {
    toast(`${val} is already in the blocked list`, 'warning');
  }
  if (input) input.value = '';
}

function removeBlockedDomain(idx) {
  if (idx >= 0 && idx < blocklistState.domains.length) {
    const removed = blocklistState.domains.splice(idx, 1)[0];
    renderBlocklistUI();
    toast(`Removed ${removed} from blocked websites`, 'info');
  }
}

async function saveBlocklist() {
  try {
    const res = await apiFetch('/focus/blocklist/', {
      method: 'POST',
      body: JSON.stringify({
        blocked_apps: blocklistState.apps,
        blocked_domains: blocklistState.domains
      })
    });
    if (res.ok) {
      toast('✅ Focus Shield blocklist saved and applied!', 'success');
      closeBlocklistModal();
    } else {
      toast('Failed to save blocklist', 'danger');
    }
  } catch (e) {
    console.error('Save blocklist error:', e);
    toast('Error saving blocklist', 'danger');
  }
}

function resetBlocklistDefaults() {
  blocklistState.apps = [...DEFAULT_BLOCKLIST_APPS];
  blocklistState.domains = [...DEFAULT_BLOCKLIST_DOMAINS];
  renderBlocklistUI();
  toast('Reset blocklist to defaults. Click "Save & Apply" to confirm.', 'info');
}

// Wire Event Listeners for Blocklist Manager
qs('#btnOpenBlocklistModal')?.addEventListener('click', openBlocklistModal);
qs('#closeBlocklistModalBtn')?.addEventListener('click', closeBlocklistModal);
qs('#btnCancelBlocklist')?.addEventListener('click', closeBlocklistModal);
qs('#tabBtnBlockApps')?.addEventListener('click', () => switchBlocklistTab('apps'));
qs('#tabBtnBlockDomains')?.addEventListener('click', () => switchBlocklistTab('domains'));
qs('#btnAddBlockedApp')?.addEventListener('click', addBlockedApp);
qs('#newBlockedAppInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBlockedApp(); });
qs('#btnAddBlockedDomain')?.addEventListener('click', addBlockedDomain);
qs('#newBlockedDomainInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBlockedDomain(); });
qs('#btnSaveBlocklist')?.addEventListener('click', saveBlocklist);
qs('#btnResetBlocklistDefaults')?.addEventListener('click', resetBlocklistDefaults);

/* ═══════════════════════════════════════════════════════
   GAMIFICATION: STREAKS, ACTIVITY HEATMAP & BADGES
   ═══════════════════════════════════════════════════════ */
let currentGamificationData = null;
let currentBadgeFilter = 'all';

async function fetchGamificationData() {
  try {
    const res = await apiFetch('/dashboard/gamification/');
    if (!res.ok) return;
    const data = await res.json();
    currentGamificationData = data;
    renderGamification(data);
  } catch (err) {
    if (err.message !== 'Unauthorized') console.error('Gamification fetch error:', err);
  }
}

function renderGamification(data) {
  if (!data) return;

  // 1. Topbar Flame Streak Pill
  const topbarCount = qs('#topbarStreakCount');
  if (topbarCount) {
    topbarCount.textContent = data.streaks?.current_streak ?? 0;
  }

  // 2. Hero Streak Stats
  const heroDays = qs('#streakHeroDays');
  if (heroDays) {
    const days = data.streaks?.current_streak ?? 0;
    heroDays.textContent = `${days} Day${days === 1 ? '' : 's'}`;
  }

  const heroSub = qs('#streakHeroSub');
  if (heroSub) {
    const s = data.streaks;
    if (s?.is_active_today) {
      heroSub.textContent = "🔥 Active streak! You've logged focus time today. Keep pushing your limits!";
    } else if ((s?.current_streak ?? 0) > 0) {
      heroSub.textContent = `⚡ Streak at risk! Log a focus sprint today to protect your ${s.current_streak}-day record.`;
    } else {
      heroSub.textContent = "Ignite your journey! Complete a focus sprint today to kick off your streak.";
    }
  }

  setEl('streakBestStat', `${data.streaks?.longest_streak ?? 0}d`);
  setEl('streakTotalDaysStat', `${data.streaks?.total_active_days ?? 0}d`);

  const totalBadges = data.badges?.length ?? 0;
  const unlockedBadges = data.badges?.filter(b => b.unlocked).length ?? 0;
  setEl('streakBadgesStat', `${unlockedBadges} / ${totalBadges}`);

  // 3. Activity Contribution Heatmap (14 weeks x 7 days)
  renderActivityHeatmap(data.heatmap);

  // 4. Badges Showcase
  renderBadgesShowcase();
}

function renderActivityHeatmap(heatmapDays) {
  const container = qs('#activityHeatmapContainer');
  if (!container || !heatmapDays || !heatmapDays.length) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const weeksCount = Math.ceil(heatmapDays.length / 7);
  let weeksHtml = '';

  let totalActiveDays = 0;
  let totalProductiveMins = 0;
  let totalSessions = 0;

  for (let w = 0; w < weeksCount; w++) {
    const weekSlice = heatmapDays.slice(w * 7, (w + 1) * 7);
    let cellsHtml = '';
    for (const day of weekSlice) {
      if (day.level > 0 || day.sessions_count > 0 || day.productive_mins > 0) {
        totalActiveDays++;
        totalProductiveMins += (day.productive_mins || 0);
        totalSessions += (day.sessions_count || 0);
      }
      const isToday = (day.date === todayStr) ? 'is-today' : '';
      const isFuture = day.is_future ? 'is-future' : '';
      const levelClass = `level-${day.level}`;
      const title = day.is_future
        ? `${day.date} (Upcoming)`
        : `${day.date} (${day.day_of_week}): ${day.productive_mins}m focus · ${day.sessions_count} session${day.sessions_count === 1 ? '' : 's'}`;
      cellsHtml += `<div class="heatmap-cell ${levelClass} ${isToday} ${isFuture}" title="${title}" data-date="${day.date}"></div>`;
    }
    weeksHtml += `<div class="heatmap-week">${cellsHtml}</div>`;
  }

  const weekdayLabelsHtml = `
    <div style="display:flex; flex-direction:column; gap:4px; margin-right:8px; font-size:10px; font-weight:600; color:var(--text-400); justify-content:space-between; height:118px; padding-top:2px;">
      <span>Mon</span>
      <span>Wed</span>
      <span>Fri</span>
    </div>
  `;

  const totalHours = (totalProductiveMins / 60).toFixed(1);
  const summaryHtml = `
    <div style="margin-top:12px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; font-size:12px; color:var(--text-500); border-top:1px solid var(--border-200); padding-top:10px;">
      <div>
        <strong style="color:var(--text-800);">${totalActiveDays} active day${totalActiveDays === 1 ? '' : 's'}</strong> in the last 14 weeks · <strong style="color:var(--brand-600);">${totalHours}h</strong> total focused time · <strong style="color:var(--color-success);">${totalSessions} sessions</strong> recorded
      </div>
      <div style="font-size:11px; color:var(--text-400);">
        Hover over any cell to inspect focus intensity
      </div>
    </div>
  `;

  container.innerHTML = `
    <div style="display:flex; align-items:center;">
      ${weekdayLabelsHtml}
      <div class="heatmap-grid">${weeksHtml}</div>
    </div>
    ${summaryHtml}
  `;
}

function setBadgesFilter(filter) {
  currentBadgeFilter = filter;
  qs('#filterBadgeAll')?.classList.toggle('active', filter === 'all');
  qs('#filterBadgeUnlocked')?.classList.toggle('active', filter === 'unlocked');
  qs('#filterBadgeLocked')?.classList.toggle('active', filter === 'locked');
  renderBadgesShowcase();
}

function getBadgeArtwork(badgeId, tier, emoji) {
  const artworks = {
    first_sprint: `
      <svg viewBox="0 0 64 64" width="58" height="58" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="b_fs_glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ffedd5"/>
            <stop offset="60%" stop-color="#fdba74"/>
            <stop offset="100%" stop-color="#ea580c"/>
          </radialGradient>
          <linearGradient id="b_fs_rim" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#fef3c7"/>
            <stop offset="40%" stop-color="#d97706"/>
            <stop offset="80%" stop-color="#78350f"/>
            <stop offset="100%" stop-color="#b45309"/>
          </linearGradient>
          <linearGradient id="b_fs_flame1" x1="32" y1="52" x2="32" y2="16">
            <stop offset="0%" stop-color="#c2410c"/>
            <stop offset="40%" stop-color="#f97316"/>
            <stop offset="100%" stop-color="#fde047"/>
          </linearGradient>
          <linearGradient id="b_fs_flame2" x1="32" y1="50" x2="32" y2="24">
            <stop offset="0%" stop-color="#f97316"/>
            <stop offset="50%" stop-color="#facc15"/>
            <stop offset="100%" stop-color="#ffffff"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="28" fill="url(#b_fs_rim)"/>
        <circle cx="32" cy="32" r="24.5" fill="#431407"/>
        <circle cx="32" cy="32" r="22" fill="url(#b_fs_glow)" opacity="0.28"/>
        <circle cx="32" cy="32" r="21" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="3 2" opacity="0.7"/>
        <path d="M32 14C32 14 39 24 39 33C39 39 35 44 32 46C29 44 25 39 25 33C25 24 32 14 32 14Z" fill="url(#b_fs_flame1)"/>
        <path d="M32 23C32 23 36 29 36 34C36 37.5 34 42 32 43C30 42 28 37.5 28 34C28 29 32 23 32 23Z" fill="url(#b_fs_flame2)"/>
        <circle cx="21" cy="24" r="1.5" fill="#fde047"/>
        <circle cx="43" cy="22" r="1.8" fill="#fde047"/>
        <circle cx="41" cy="36" r="1.2" fill="#fb923c"/>
        <circle cx="23" cy="38" r="1.2" fill="#fb923c"/>
      </svg>`,

    streak_3: `
      <svg viewBox="0 0 64 64" width="58" height="58" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="b_s3_rim" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#ffedd5"/>
            <stop offset="35%" stop-color="#ea580c"/>
            <stop offset="70%" stop-color="#9a3412"/>
            <stop offset="100%" stop-color="#fed7aa"/>
          </linearGradient>
          <linearGradient id="b_s3_fire" x1="32" y1="52" x2="32" y2="12">
            <stop offset="0%" stop-color="#dc2626"/>
            <stop offset="35%" stop-color="#f97316"/>
            <stop offset="70%" stop-color="#fbbf24"/>
            <stop offset="100%" stop-color="#ffffff"/>
          </linearGradient>
        </defs>
        <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" fill="url(#b_s3_rim)"/>
        <polygon points="32,8 52,20 52,44 32,56 12,44 12,20" fill="#2a0802"/>
        <circle cx="32" cy="32" r="18" stroke="#f97316" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.8"/>
        <path d="M32 12C34 22 44 26 44 36C44 44 38 49 32 49C26 49 20 44 20 36C20 26 30 22 32 12Z" fill="url(#b_s3_fire)"/>
        <path d="M32 24C33.5 28 38 31 38 37C38 41 35 44 32 44C29 44 26 41 26 37C26 31 30.5 28 32 24Z" fill="#fffbe7"/>
        <polygon points="32,15 33.5,19 32,18 30.5,19" fill="#fff"/>
        <polygon points="22,30 24,31 23,29" fill="#fde047"/>
        <polygon points="42,30 43,29 42,31" fill="#fde047"/>
      </svg>`,

    streak_7: `
      <svg viewBox="0 0 64 64" width="58" height="58" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="b_w7_metal" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#f8fafc"/>
            <stop offset="40%" stop-color="#94a3b8"/>
            <stop offset="70%" stop-color="#334155"/>
            <stop offset="100%" stop-color="#cbd5e1"/>
          </linearGradient>
          <linearGradient id="b_w7_bolt" x1="32" y1="12" x2="32" y2="52">
            <stop offset="0%" stop-color="#e0f2fe"/>
            <stop offset="40%" stop-color="#38bdf8"/>
            <stop offset="100%" stop-color="#0284c7"/>
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="52" height="52" rx="14" fill="url(#b_w7_metal)"/>
        <rect x="9" y="9" width="46" height="46" rx="11" fill="#0f172a"/>
        <circle cx="32" cy="32" r="18" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.6"/>
        <circle cx="32" cy="32" r="14" fill="#0369a1" opacity="0.25"/>
        <path d="M35 12L19 32H31L27 52L45 28H32L35 12Z" fill="url(#b_w7_bolt)"/>
        <path d="M34 16L24 31H32L29 44L41 29H32L34 16Z" fill="#ffffff" opacity="0.85"/>
        <circle cx="16" cy="18" r="1.5" fill="#38bdf8"/>
        <circle cx="48" cy="46" r="1.5" fill="#38bdf8"/>
      </svg>`,

    streak_30: `
      <svg viewBox="0 0 64 64" width="58" height="58" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="b_mt_gold" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#fef08a"/>
            <stop offset="25%" stop-color="#f59e0b"/>
            <stop offset="60%" stop-color="#b45309"/>
            <stop offset="85%" stop-color="#fbbf24"/>
            <stop offset="100%" stop-color="#fef9c3"/>
          </linearGradient>
          <linearGradient id="b_mt_star" x1="32" y1="18" x2="32" y2="46">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="40%" stop-color="#fef08a"/>
            <stop offset="100%" stop-color="#f59e0b"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="29" fill="url(#b_mt_gold)"/>
        <circle cx="32" cy="32" r="25" fill="#451a03"/>
        <circle cx="32" cy="32" r="22.5" stroke="#fcd34d" stroke-width="1.2" stroke-dasharray="2 2"/>
        <path d="M18 36C17 28 22 22 25 20C24 23 25 28 27 30C24 32 20 34 18 36Z" fill="#f59e0b"/>
        <path d="M46 36C47 28 42 22 39 20C40 23 39 28 37 30C40 32 44 34 46 36Z" fill="#f59e0b"/>
        <polygon points="32,15 36.5,25 47,26.5 39,34 41,45 32,39.5 23,45 25,34 17,26.5 27.5,25" fill="url(#b_mt_star)"/>
        <polygon points="32,15 36.5,25 32,39.5" fill="#ffffff" opacity="0.45"/>
        <polygon points="32,6 33,10 32,9 31,10" fill="#fff"/>
        <polygon points="50,18 51.5,21 50,20.5 48.5,21" fill="#fef08a"/>
        <polygon points="14,18 15.5,21 14,20.5 12.5,21" fill="#fef08a"/>
      </svg>`,

    zero_drift: `
      <svg viewBox="0 0 64 64" width="58" height="58" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="b_zd_silver" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="35%" stop-color="#94a3b8"/>
            <stop offset="70%" stop-color="#475569"/>
            <stop offset="100%" stop-color="#cbd5e1"/>
          </linearGradient>
          <linearGradient id="b_zd_laser" x1="32" y1="14" x2="32" y2="50">
            <stop offset="0%" stop-color="#6ee7b7"/>
            <stop offset="50%" stop-color="#10b981"/>
            <stop offset="100%" stop-color="#047857"/>
          </linearGradient>
        </defs>
        <path d="M32 6L53 14V30C53 43 44 54 32 58C20 54 11 43 11 30V14L32 6Z" fill="url(#b_zd_silver)"/>
        <path d="M32 10L49 17V30C49 41 41 50 32 54C23 50 15 41 15 30V17L32 10Z" fill="#022c22"/>
        <circle cx="32" cy="32" r="14" stroke="url(#b_zd_laser)" stroke-width="2"/>
        <circle cx="32" cy="32" r="8" stroke="#a7f3d0" stroke-width="1.2" stroke-dasharray="3 2"/>
        <circle cx="32" cy="32" r="3" fill="#ffffff"/>
        <line x1="32" y1="15" x2="32" y2="23" stroke="#34d399" stroke-width="2" stroke-linecap="round"/>
        <line x1="32" y1="41" x2="32" y2="49" stroke="#34d399" stroke-width="2" stroke-linecap="round"/>
        <line x1="15" y1="32" x2="23" y2="32" stroke="#34d399" stroke-width="2" stroke-linecap="round"/>
        <line x1="41" y1="32" x2="49" y2="32" stroke="#34d399" stroke-width="2" stroke-linecap="round"/>
      </svg>`,

    deep_diver: `
      <svg viewBox="0 0 64 64" width="58" height="58" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="b_dd_gold" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#fef08a"/>
            <stop offset="30%" stop-color="#f59e0b"/>
            <stop offset="70%" stop-color="#b45309"/>
            <stop offset="100%" stop-color="#fde047"/>
          </linearGradient>
          <radialGradient id="b_dd_abyss" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#2563eb"/>
            <stop offset="60%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#020617"/>
          </radialGradient>
        </defs>
        <rect x="28" y="4" width="8" height="6" rx="2" fill="url(#b_dd_gold)"/>
        <circle cx="32" cy="35" r="25" fill="url(#b_dd_gold)"/>
        <circle cx="32" cy="35" r="21" fill="url(#b_dd_abyss)"/>
        <circle cx="32" cy="35" r="18" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="2 4" opacity="0.7"/>
        <line x1="32" y1="18" x2="32" y2="21" stroke="#fef08a" stroke-width="2"/>
        <line x1="49" y1="35" x2="46" y2="35" stroke="#fef08a" stroke-width="2"/>
        <line x1="32" y1="52" x2="32" y2="49" stroke="#fef08a" stroke-width="2"/>
        <line x1="15" y1="35" x2="18" y2="35" stroke="#fef08a" stroke-width="2"/>
        <line x1="32" y1="35" x2="42" y2="25" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round"/>
        <line x1="32" y1="35" x2="26" y2="28" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/>
        <circle cx="32" cy="35" r="3.5" fill="#fde047"/>
      </svg>`,

    early_bird: `
      <svg viewBox="0 0 64 64" width="58" height="58" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="b_eb_rim" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#ffedd5"/>
            <stop offset="40%" stop-color="#f97316"/>
            <stop offset="80%" stop-color="#9a3412"/>
            <stop offset="100%" stop-color="#fed7aa"/>
          </linearGradient>
          <linearGradient id="b_eb_sky" x1="32" y1="10" x2="32" y2="44">
            <stop offset="0%" stop-color="#fda4af"/>
            <stop offset="50%" stop-color="#fdba74"/>
            <stop offset="100%" stop-color="#fef08a"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="28" fill="url(#b_eb_rim)"/>
        <circle cx="32" cy="32" r="24" fill="#431407"/>
        <path d="M12 34C14 22 22 14 32 14C42 14 50 22 52 34Z" fill="url(#b_eb_sky)"/>
        <circle cx="32" cy="34" r="9" fill="#fef08a"/>
        <line x1="32" y1="18" x2="32" y2="21" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <line x1="22" y1="23" x2="24" y2="25" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <line x1="42" y1="23" x2="40" y2="25" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <polygon points="12,48 24,32 36,48" fill="#78350f"/>
        <polygon points="28,48 42,28 54,48" fill="#9a3412"/>
        <polygon points="28,48 42,28 36,48" fill="#b45309" opacity="0.65"/>
      </svg>`,

    night_owl: `
      <svg viewBox="0 0 64 64" width="58" height="58" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="b_no_rim" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#e9d5ff"/>
            <stop offset="40%" stop-color="#9333ea"/>
            <stop offset="80%" stop-color="#4c1d95"/>
            <stop offset="100%" stop-color="#c084fc"/>
          </linearGradient>
          <linearGradient id="b_no_moon" x1="24" y1="14" x2="46" y2="46">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="60%" stop-color="#fde047"/>
            <stop offset="100%" stop-color="#ca8a04"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="28" fill="url(#b_no_rim)"/>
        <circle cx="32" cy="32" r="24" fill="#0f0728"/>
        <path d="M38 14C30 14 24 21 24 30C24 39 31 46 39 46C42 46 45 45 47 43C40 43 34 37 34 30C34 22 39 16 46 15C43 14 41 14 38 14Z" fill="url(#b_no_moon)"/>
        <circle cx="28" cy="32" r="8" fill="#1e1b4b"/>
        <circle cx="25.5" cy="31" r="2.2" fill="#fde047"/>
        <circle cx="25.5" cy="31" r="1" fill="#000"/>
        <circle cx="30.5" cy="31" r="2.2" fill="#fde047"/>
        <circle cx="30.5" cy="31" r="1" fill="#000"/>
        <polygon points="28,33 27,35 29,35" fill="#f97316"/>
        <circle cx="18" cy="20" r="1" fill="#ffffff"/>
        <circle cx="21" cy="42" r="1.2" fill="#e9d5ff"/>
        <polygon points="46,24 47.5,27 46,26 44.5,27" fill="#fde047"/>
      </svg>`,

    century_club: `
      <svg viewBox="0 0 64 64" width="58" height="58" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="b_cc_plat" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="35%" stop-color="#cbd5e1"/>
            <stop offset="70%" stop-color="#64748b"/>
            <stop offset="100%" stop-color="#e2e8f0"/>
          </linearGradient>
          <linearGradient id="b_cc_gem" x1="32" y1="12" x2="32" y2="30">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="40%" stop-color="#38bdf8"/>
            <stop offset="100%" stop-color="#0284c7"/>
          </linearGradient>
        </defs>
        <polygon points="32,4 58,16 58,48 32,60 6,48 6,16" fill="url(#b_cc_plat)"/>
        <polygon points="32,8 54,18 54,46 32,56 10,46 10,18" fill="#091326"/>
        <polygon points="26,14 38,14 43,21 32,30 21,21" fill="url(#b_cc_gem)"/>
        <polygon points="26,14 38,14 32,21" fill="#ffffff" opacity="0.6"/>
        <text x="32" y="46" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="15" fill="#f8fafc" text-anchor="middle" letter-spacing="-0.5">100</text>
        <text x="32" y="53" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="6.5" fill="#38bdf8" text-anchor="middle" letter-spacing="1">MINS</text>
        <circle cx="16" cy="18" r="1.5" fill="#38bdf8"/>
        <circle cx="48" cy="18" r="1.5" fill="#38bdf8"/>
      </svg>`,

    grandmaster: `
      <svg viewBox="0 0 64 64" width="58" height="58" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="b_gm_diamond" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#f0fdf4"/>
            <stop offset="25%" stop-color="#38bdf8"/>
            <stop offset="50%" stop-color="#818cf8"/>
            <stop offset="75%" stop-color="#c084fc"/>
            <stop offset="100%" stop-color="#f43f5e"/>
          </linearGradient>
          <linearGradient id="b_gm_crown" x1="32" y1="18" x2="32" y2="48">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="35%" stop-color="#7dd3fc"/>
            <stop offset="70%" stop-color="#0284c7"/>
            <stop offset="100%" stop-color="#0369a1"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="29" stroke="url(#b_gm_diamond)" stroke-width="3"/>
        <circle cx="32" cy="32" r="26" fill="#030712"/>
        <circle cx="32" cy="32" r="21" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.8"/>
        <path d="M16 44L18 25L26 34L32 18L38 34L46 25L48 44H16Z" fill="url(#b_gm_crown)"/>
        <rect x="16" y="44" width="32" height="4" rx="1.5" fill="#38bdf8"/>
        <circle cx="32" cy="18" r="3" fill="#ffffff"/>
        <circle cx="18" cy="25" r="2.2" fill="#c084fc"/>
        <circle cx="46" cy="25" r="2.2" fill="#c084fc"/>
        <circle cx="32" cy="46" r="1.5" fill="#ffffff"/>
        <circle cx="24" cy="46" r="1.5" fill="#f43f5e"/>
        <circle cx="40" cy="46" r="1.5" fill="#f43f5e"/>
        <polygon points="32,7 33.5,11 32,10 30.5,11" fill="#ffffff"/>
        <polygon points="12,18 13.5,20.5 12,19.5 10.5,20.5" fill="#38bdf8"/>
        <polygon points="52,18 53.5,20.5 52,19.5 50.5,20.5" fill="#c084fc"/>
      </svg>`,
  };

  return artworks[badgeId] || `<span style="font-size:32px;">${emoji || '🏆'}</span>`;
}

function renderBadgesShowcase() {
  const container = qs('#badgesGridContainer');
  if (!container || !currentGamificationData) return;

  const allBadges = currentGamificationData.badges || [];
  const filtered = allBadges.filter(b => {
    if (currentBadgeFilter === 'unlocked') return b.unlocked;
    if (currentBadgeFilter === 'locked') return !b.unlocked;
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = `<div class="empty" style="grid-column: 1 / -1;">
      <div class="empty-icon">🏅</div>
      <div class="empty-title">No badges in this view</div>
      <div class="empty-desc">Complete more focus sprints to unlock milestone badges.</div>
    </div>`;
    return;
  }

  container.innerHTML = filtered.map(b => {
    const statusClass = b.unlocked ? 'unlocked' : 'locked';
    const tierClass = `tier-${(b.tier || 'bronze').toLowerCase()}`;
    const tierChipClass = (b.tier || 'bronze').toLowerCase();
    const artworkSvg = getBadgeArtwork(b.id, b.tier, b.icon);

    const statusChip = b.unlocked
      ? `<span class="badge-status-chip unlocked"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Unlocked</span>`
      : `<span class="badge-status-chip locked">🔒 In Progress</span>`;

    let footerHtml = '';
    if (b.unlocked) {
      footerHtml = `
        <div class="badge-unlocked-pill">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          Earned · ${htmlEsc(b.progress_label)}
        </div>
      `;
    } else {
      footerHtml = `
        <div class="badge-footer-progress">
          <div class="badge-progress-meta">
            <span>Progress: ${htmlEsc(b.progress_label)}</span>
            <span>${b.progress_pct}%</span>
          </div>
          <div class="badge-progress-track">
            <div class="badge-progress-fill" style="width: ${b.progress_pct}%"></div>
          </div>
        </div>
      `;
    }

    return `
      <div class="badge-card ${statusClass} ${tierClass}">
        <div class="badge-top-row">
          <div class="badge-icon-wrap">${artworkSvg}</div>
          <div class="badge-top-tags">
            <span class="badge-tier-chip ${tierChipClass}">${b.tier}</span>
            ${statusChip}
          </div>
        </div>
        <div class="badge-name">${htmlEsc(b.name || b.title)}</div>
        <div class="badge-desc">${htmlEsc(b.description)}</div>
        ${footerHtml}
      </div>
    `;
  }).join('');
}

// Wire Gamification Event Listeners
qs('#topbarStreakWidget')?.addEventListener('click', () => switchTab('achievements'));
qs('#filterBadgeAll')?.addEventListener('click', () => setBadgesFilter('all'));
qs('#filterBadgeUnlocked')?.addEventListener('click', () => setBadgesFilter('unlocked'));
qs('#filterBadgeLocked')?.addEventListener('click', () => setBadgesFilter('locked'));
/* ═══════════════════════════════════════════════════════
   MILESTONE 3: M3 ENGINE MODULE
   ═══════════════════════════════════════════════════════ */
let idlePopupCountdownTimer = null;
let idlePopupSecondsLeft = 180;

function initTheme() {
  const saved = localStorage.getItem('fg_theme') || 'light';
  applyTheme(saved);
  qs('#themeToggleBtn')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('fg_theme', theme);
  const sun = qs('#themeIconSun');
  const moon = qs('#themeIconMoon');
  if (theme === 'dark') {
    if (sun) sun.style.display = 'none';
    if (moon) moon.style.display = 'block';
  } else {
    if (sun) sun.style.display = 'block';
    if (moon) moon.style.display = 'none';
  }
}

function initI18n() {
  const sel = qs('#globalLangSelect');
  if (sel && window.fgI18n) {
    sel.value = window.fgI18n.getLang();
    sel.addEventListener('change', () => {
      window.fgI18n.setLang(sel.value);
    });
  }
}

function initProfileDropdown() {
  const btn = qs('#profileMenuBtn');
  const menu = qs('#profileDropdownMenu');
  if (!btn || !menu) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== btn) {
      menu.style.display = 'none';
    }
  });
  qs('#dropdownProfileBtn')?.addEventListener('click', () => {
    menu.style.display = 'none';
    switchTab('profile');
  });
  qs('#dropdownManageBtn')?.addEventListener('click', () => {
    menu.style.display = 'none';
    switchTab('profile');
  });
  qs('#dropdownLogoutBtn')?.addEventListener('click', () => {
    menu.style.display = 'none';
    signOut();
  });
}

async function updateCurrentFocusDisplay() {
  try {
    const res = await apiFetch('/focus/current-status/');
    if (!res.ok) return;
    const d = await res.json();
    setEl('cfGoal', d.goal || 'Studying');
    setEl('cfApp', d.current_app || '—');
    const tabEl = qs('#cfTab');
    if (tabEl) {
      tabEl.textContent = d.current_tab || 'Current tab information unavailable';
      tabEl.title = d.current_tab || 'Current tab information unavailable';
    }
    setEl('cfDomain', d.domain || '—');
    setEl('cfDuration', formatDuration(d.duration_secs || 0));

    const badgeEl = qs('#cfStatusBadge');
    if (badgeEl) {
      badgeEl.textContent = d.status || 'Idle';
      if (d.status === 'Focused') {
        badgeEl.style.background = 'var(--color-success-bg)';
        badgeEl.style.color = 'var(--color-success)';
      } else if (d.status === 'Distracted' || d.status === 'Blocked') {
        badgeEl.style.background = 'var(--color-danger-bg)';
        badgeEl.style.color = 'var(--color-danger)';
      } else {
        badgeEl.style.background = 'var(--bg-muted)';
        badgeEl.style.color = 'var(--text-600)';
      }
    }

    if (d.should_prompt_idle) showIdlePopup(d);
    if (d.should_prompt_return) showReturnExperience(d);
    if (d.should_prompt_hourly) showHourlyRefresh(d);
  } catch (e) {}
}

function showIdlePopup(d) {
  const modal = qs('#idleDistractionModal');
  if (!modal || modal.style.display === 'flex') return;

  const rawGoal = d.goal || 'STUDYING';
  const displayGoal = goalLabel(rawGoal);
  setEl('idleGoalDisplay', displayGoal);
  setEl('idleAppDisplay', d.current_app || '—');
  setEl('idleTabDisplay', d.current_tab || 'Current tab information unavailable');

  const questions = {
    'STUDYING': 'What topic are you currently studying?',
    'CODING': 'What are you currently trying to implement?',
    'ASSIGNMENT': 'What part of the assignment are you working on?',
    'ONLINE_LEARNING': 'What topic are you learning right now?',
    'GAMES': 'What are you playing or exploring right now?',
    'OTHER': 'What are you currently focusing on?',
  };
  const goalKey = String(rawGoal).toUpperCase();
  setEl('idleGoalQuestion', questions[goalKey] || questions['STUDYING']);

  modal.style.display = 'flex';
  idlePopupSecondsLeft = 180;
  setEl('idleCountdownSecs', idlePopupSecondsLeft);

  if (idlePopupCountdownTimer) clearInterval(idlePopupCountdownTimer);
  idlePopupCountdownTimer = setInterval(async () => {
    idlePopupSecondsLeft--;
    setEl('idleCountdownSecs', idlePopupSecondsLeft);
    if (idlePopupSecondsLeft <= 0) {
      clearInterval(idlePopupCountdownTimer);
      modal.style.display = 'none';
      await apiFetch('/focus/idle-response/', {
        method: 'POST',
        body: JSON.stringify({ action: 'LOCK' })
      });
      toast('Focus session auto-locked due to inactivity.', 'danger');
    }
  }, 1000);
}

function closeIdlePopup() {
  const modal = qs('#idleDistractionModal');
  if (modal) modal.style.display = 'none';
  if (idlePopupCountdownTimer) clearInterval(idlePopupCountdownTimer);
}
function initIdleModalListeners() {
  qs('#idleActiveBtn')?.addEventListener('click', async () => {
    const topic = qs('#idleTopicAnswer')?.value || '';
    closeIdlePopup();
    try {
      await apiFetch('/focus/idle-response/', {
        method: 'POST',
        body: JSON.stringify({ action: 'ACTIVE', topic })
      });
      toast("Welcome back! You're marked active.", 'success');
    } catch (e) {}
  });

  qs('#idleAwayBtn')?.addEventListener('click', async () => {
    closeIdlePopup();
    try {
      await apiFetch('/focus/idle-response/', {
        method: 'POST',
        body: JSON.stringify({ action: 'AWAY' })
      });
      toast("Marked as Away. We'll pause your session.", 'info');
    } catch (e) {}
  });
}

function showReturnExperience(d) {
  const modal = qs('#returnExperienceModal');
  if (!modal || modal.style.display === 'flex') return;

  const awayMins = Math.round((d.away_secs || 0) / 60);
  setEl('returnAwayTitle', `You were away for ${awayMins} minute${awayMins === 1 ? '' : 's'}.`);

  const msgEl = qs('#returnMotivationalMsg');
  const resumeBtn = qs('#returnResumeBtn');
  if (msgEl) msgEl.style.display = 'none';
  if (resumeBtn) resumeBtn.style.display = 'none';

  modal.style.display = 'flex';
}

function initReturnExperienceListeners() {
  qsa('.return-activity-choice').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = btn.getAttribute('data-act');
      const msgEl = qs('#returnMotivationalMsg');
      const resumeBtn = qs('#returnResumeBtn');

      try {
        await apiFetch('/focus/return-response/', {
          method: 'POST',
          body: JSON.stringify({ activity: act })
        });
      } catch (e) {}

      if (msgEl) {
        msgEl.textContent = "Welcome back. Let's continue your focus session.";
        msgEl.style.display = 'block';
      }
      if (resumeBtn) {
        resumeBtn.style.display = 'block';
      }
    });
  });

  qs('#returnResumeBtn')?.addEventListener('click', () => {
    const modal = qs('#returnExperienceModal');
    if (modal) modal.style.display = 'none';
  });
}

function showHourlyRefresh(d) {
  const modal = qs('#hourlyRefreshModal');
  if (!modal || modal.style.display === 'flex') return;

  const rawGoal = d.goal || 'STUDYING';
  const label = goalLabel(rawGoal).toUpperCase();
  setEl('refreshGoalTag', `${label} REFRESH`);

  const qMap = {
    'CODING': 'Quick sanity check: Are edge cases and error handlers covered in your latest function?',
    'STUDYING': 'Quick comprehension check: Can you summarize the core concept you just read in one sentence?',
    'ASSIGNMENT': 'Milestone check: What is the remaining key section needed to complete this deliverable?',
    'ONLINE_LEARNING': 'Concept check: What was the primary takeaway from the last lesson or video segment?',
    'GAMES': 'Session check: Are you feeling refreshed and ready to return to focused work?',
    'OTHER': 'Focus check: What is the main progress you made during this past hour?',
  };
  const goalKey = String(rawGoal).toUpperCase();
  setEl('refreshQuestionText', qMap[goalKey] || qMap['STUDYING']);

  modal.style.display = 'flex';
}

function initHourlyRefreshListeners() {
  qs('#btnDismissRefresh')?.addEventListener('click', () => {
    const modal = qs('#hourlyRefreshModal');
    if (modal) modal.style.display = 'none';
  });
  qs('#btnAcknowledgeRefresh')?.addEventListener('click', () => {
    const modal = qs('#hourlyRefreshModal');
    if (modal) modal.style.display = 'none';
    toast('Great work! Keep up the deep focus.', 'success');
  });
}

/* ═══════════════════════════════════════════════════════
   MILESTONE 3: AI CHATBOT CONTROLLER (Feature 9)
   ═══════════════════════════════════════════════════════ */
function initAIChat() {
  const input = qs('#aiChatInput');
  const sendBtn = qs('#aiChatSendBtn');
  const msgs = qs('#aiChatMessages');

  if (!input || !sendBtn || !msgs) return;

  const sendMessage = async () => {
    const question = input.value.trim();
    if (!question) return;

    input.value = '';

    const userMsg = document.createElement('div');
    userMsg.className = 'chat-msg chat-msg-user';
    userMsg.style.cssText = 'display:flex; justify-content:flex-end; gap:10px; align-self:flex-end; max-width:85%;';
    userMsg.innerHTML = `
      <div style="background:var(--brand-600); color:white; border-radius:var(--r-md); padding:10px 14px; font-size:13.5px; line-height:1.5;">
        ${htmlEsc(question)}
      </div>
    `;
    msgs.appendChild(userMsg);
    msgs.scrollTop = msgs.scrollHeight;

    const botLoading = document.createElement('div');
    botLoading.className = 'chat-msg chat-msg-bot';
    botLoading.style.cssText = 'display:flex; gap:10px; max-width:85%;';
    botLoading.innerHTML = `
      <div style="width:30px; height:30px; border-radius:50%; background:var(--brand-500); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:13px;">🤖</div>
      <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--r-md); padding:10px 14px; font-size:13.5px; color:var(--text-600);">
        Thinking...
      </div>
    `;
    msgs.appendChild(botLoading);
    msgs.scrollTop = msgs.scrollHeight;

    try {
      const lang = (window.fgI18n && window.fgI18n.getLang && window.fgI18n.getLang()) || 'en';
      const res = await apiFetch('/ai/ask/', {
        method: 'POST',
        body: JSON.stringify({ question, lang })
      });
      botLoading.remove();

      let reply = "I don't have enough activity data to answer that yet.";
      let replySource = '';
      if (res.ok) {
        const d = await res.json();
        reply = d.answer || d.response || reply;
        const src = d.source || (Array.isArray(d.sources) && d.sources.length === 1 ? d.sources[0] : '');
        // Knowledge answers keep only one small optional source line; raw
        // chunks are never rendered because the backend now summarizes them.
        if (d.intent === 'knowledge' && src) replySource = `Source: ${src}`;
      } else {
        let detail = '';
        try {
          const err = await res.json();
          detail = err.detail || err.error || '';
        } catch {}
        reply = res.status === 401
          ? 'Please sign in again to use the AI Assistant.'
          : (detail ? `Request failed (${res.status}): ${detail}` : `Request failed (${res.status}). Please try again.`);
      }

      // Answers are already escaped, so only the safe **bold** markers that the
      // backend emits are upgraded to <strong>; nothing else is interpreted.
      const replyHtml = htmlEsc(reply).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      const sourceHtml = replySource
        ? `<div style="margin-top:6px; font-size:11.5px; color:var(--text-600);">${htmlEsc(replySource)}</div>`
        : '';

      const botMsg = document.createElement('div');
      botMsg.className = 'chat-msg chat-msg-bot';
      botMsg.style.cssText = 'display:flex; gap:10px; max-width:85%;';
      botMsg.innerHTML = `
        <div style="width:30px; height:30px; border-radius:50%; background:var(--brand-500); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:13px;">🤖</div>
        <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--r-md); padding:12px 16px; font-size:13.5px; line-height:1.6; color:var(--text-900); white-space:pre-wrap;">
          ${replyHtml}${sourceHtml}
        </div>
      `;
      msgs.appendChild(botMsg);
      msgs.scrollTop = msgs.scrollHeight;
    } catch (e) {
      botLoading.remove();
      const botMsg = document.createElement('div');
      botMsg.className = 'chat-msg chat-msg-bot';
      botMsg.style.cssText = 'display:flex; gap:10px; max-width:85%;';
      botMsg.innerHTML = `
        <div style="width:30px; height:30px; border-radius:50%; background:var(--brand-500); color:white; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:13px;">🤖</div>
        <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--r-md); padding:12px 16px; font-size:13.5px; line-height:1.6; color:var(--text-900);">
          I don't have enough activity data to answer that yet.
        </div>
      `;
      msgs.appendChild(botMsg);
      msgs.scrollTop = msgs.scrollHeight;
    }
  };

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  qsa('.chat-quick-prompt').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.getAttribute('data-prompt') || '';
      sendMessage();
    });
  });
}



/* ═══════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════ */
function initApp() {
  hideLogin();
  updateSoundToggleUI();
  initTheme();
  initI18n();
  initProfileDropdown();
  initIdleModalListeners();
  initReturnExperienceListeners();
  initHourlyRefreshListeners();
  initAIChat();
  const u = state.username || 'User';
  qs('#userAvatar').textContent = u.charAt(0).toUpperCase();
  qs('#sidebarUsername').textContent = u;
  qs('#headerProfileName').textContent = u;
  switchTab('dashboard');
  fetchGamificationData();
  updateCurrentFocusDisplay();
  startPoll();


  window.addEventListener('focusguard-extension-ready', () => {
    const extValEl = qs('#extVal');
    if (extValEl) {
      extValEl.textContent = 'Connected';
      extValEl.style.color = 'var(--color-success)';
    }
    setEl('extMeta', 'Ready · Synced with browser');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initPasswordToggles();
  loadToken();
  if (state.token) {
    hideLogin();
    initApp();
  } else {
    showLogin();
  }
});

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */
function qs(sel) { return document.querySelector(sel); }
function qsa(sel) { return document.querySelectorAll(sel); }
function val(id) { return (qs(`#${id}`) || {}).value || ''; }
function setEl(id, text) {
  const el = qs(`#${id}`);
  if (el) {
    const s = String(text ?? '');
    if (el.textContent !== s) {
      el.textContent = s;
    }
  }
}
function htmlEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function faviconImg(domain) {
  if (!domain) return '';
  return `<img class="domain-favicon" src="https://www.google.com/s2/favicons?sz=16&domain=${encodeURIComponent(domain)}" alt="" onerror="this.style.display='none'">`;
}

function emptyRow(cols, icon, title, desc) {
  return `<tr><td colspan="${cols}"><div class="empty">
    <div class="empty-icon">${icon}</div>
    <div class="empty-title">${title}</div>
    <div class="empty-desc">${desc}</div>
  </div></td></tr>`;
}

window.showAuthTab = showAuthTab;
window.scrollToAuth = scrollToAuth;
window.deleteGoal = deleteGoal;
window.startFocusSession = startFocusSession;
window.endFocusSession = endFocusSession;
window.openAIReportModal = openAIReportModal;
window.loadDateReport = loadDateReport;
window.deleteDateData = deleteDateData;
window.loadTrends = loadTrends;
window.exportTrendsCSV = exportTrendsCSV;
window.playChime = playChime;
window.toggleSoundMute = toggleSoundMute;
window.showBreakReminderModal = showBreakReminderModal;
window.closeBreakReminderModal = closeBreakReminderModal;
window.openBlocklistModal = openBlocklistModal;
window.closeBlocklistModal = closeBlocklistModal;
window.removeBlockedApp = removeBlockedApp;
window.removeBlockedDomain = removeBlockedDomain;
window.fetchGamificationData = fetchGamificationData;
window.setBadgesFilter = setBadgesFilter;
