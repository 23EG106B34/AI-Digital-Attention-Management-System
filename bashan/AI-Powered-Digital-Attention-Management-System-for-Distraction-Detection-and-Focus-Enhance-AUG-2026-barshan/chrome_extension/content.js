// Injected into web pages to observe user engagement, dynamic metadata, & Focus Shield protection
let lastUserInteraction = Date.now();

function markActive() {
  lastUserInteraction = Date.now();
}

window.addEventListener("mousemove", markActive, { passive: true });
window.addEventListener("keydown", markActive, { passive: true });
window.addEventListener("scroll", markActive, { passive: true });
window.addEventListener("click", markActive, { passive: true });

// Auto-sync authentication & session status when user is on the FocusGuard Web App
if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
  try {
    document.documentElement.setAttribute("data-focusguard-extension", "connected");
    window.dispatchEvent(new CustomEvent('focusguard-extension-ready'));
  } catch (e) {}

  function syncAuthAndSessionFromPage() {
    try {
      document.documentElement.setAttribute("data-focusguard-extension", "connected");
      const token = localStorage.getItem("focusguard_access_token") || localStorage.getItem("fg_token");
      const refresh = localStorage.getItem("focusguard_refresh_token") || localStorage.getItem("fg_refresh");
      if (token) {
        chrome.runtime.sendMessage({
          type: "SYNC_AUTH_TOKEN",
          token: token,
          refresh: refresh || ""
        }).catch(() => {});
      }

      const activeVal = localStorage.getItem("focusguard_session_active");
      const isSessionActive = activeVal === "true";
      chrome.runtime.sendMessage({
        type: "SET_SESSION_STATUS",
        active: isSessionActive
      }).catch(() => {});
    } catch (e) {}
  }

  syncAuthAndSessionFromPage();
  setInterval(syncAuthAndSessionFromPage, 2500);
}

// ═══════════════════════════════════════════════════════
// FOCUS SHIELD OVERLAY (Feature 1)
// ═══════════════════════════════════════════════════════
const SHIELD_OVERLAY_ID = "focusguard-shield-root";

function removeShieldOverlay() {
  const existing = document.getElementById(SHIELD_OVERLAY_ID);
  if (existing) existing.remove();
}

function injectShieldOverlay(info) {
  if (document.getElementById(SHIELD_OVERLAY_ID)) return; // Already shielded

  const hostname = window.location.hostname;
  const overlay = document.createElement("div");
  overlay.id = SHIELD_OVERLAY_ID;
  overlay.innerHTML = `
    <style>
      #${SHIELD_OVERLAY_ID} {
        position: fixed !important;
        inset: 0 !important;
        background: radial-gradient(circle at center, rgba(30, 27, 75, 0.96) 0%, rgba(15, 23, 42, 0.98) 100%) !important;
        backdrop-filter: blur(18px) saturate(180%) !important;
        -webkit-backdrop-filter: blur(18px) saturate(180%) !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
        color: #ffffff !important;
        box-sizing: border-box !important;
        animation: fgShieldFadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      @keyframes fgShieldFadeIn {
        from { opacity: 0; transform: scale(0.98); }
        to { opacity: 1; transform: scale(1); }
      }
      .fg-shield-card {
        background: rgba(30, 41, 59, 0.85) !important;
        border: 1.5px solid rgba(129, 140, 248, 0.35) !important;
        box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.6), 0 0 40px -10px rgba(99, 102, 241, 0.4) !important;
        border-radius: 20px !important;
        padding: 40px 36px !important;
        max-width: 480px !important;
        width: 92% !important;
        text-align: center !important;
        box-sizing: border-box !important;
      }
      .fg-shield-icon-wrap {
        width: 72px !important;
        height: 72px !important;
        margin: 0 auto 20px !important;
        background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%) !important;
        border-radius: 20px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.5) !important;
      }
      .fg-shield-badge {
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        background: rgba(239, 68, 68, 0.15) !important;
        border: 1px solid rgba(239, 68, 68, 0.3) !important;
        color: #fca5a5 !important;
        padding: 5px 12px !important;
        border-radius: 999px !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        letter-spacing: 0.5px !important;
        text-transform: uppercase !important;
        margin-bottom: 16px !important;
      }
      .fg-shield-title {
        font-size: 24px !important;
        font-weight: 800 !important;
        color: #ffffff !important;
        margin: 0 0 10px 0 !important;
        line-height: 1.25 !important;
        letter-spacing: -0.3px !important;
      }
      .fg-shield-desc {
        font-size: 14px !important;
        line-height: 1.6 !important;
        color: #cbd5e1 !important;
        margin: 0 0 28px 0 !important;
      }
      .fg-shield-domain {
        color: #a5b4fc !important;
        font-weight: 600 !important;
        background: rgba(99, 102, 241, 0.15) !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
      }
      .fg-shield-actions {
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
      }
      .fg-shield-btn-primary {
        background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%) !important;
        color: #ffffff !important;
        border: none !important;
        padding: 13px 20px !important;
        border-radius: 12px !important;
        font-size: 14px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        transition: all 0.2s ease !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 8px !important;
        box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4) !important;
      }
      .fg-shield-btn-primary:hover {
        transform: translateY(-1px) !important;
        box-shadow: 0 6px 20px rgba(79, 70, 229, 0.5) !important;
      }
      .fg-shield-btn-secondary {
        background: rgba(255, 255, 255, 0.08) !important;
        color: #cbd5e1 !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        padding: 11px 20px !important;
        border-radius: 12px !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        transition: all 0.2s ease !important;
      }
      .fg-shield-btn-secondary:hover {
        background: rgba(255, 255, 255, 0.14) !important;
        color: #ffffff !important;
      }
    </style>
    <div class="fg-shield-card">
      <div class="fg-shield-icon-wrap">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <circle cx="12" cy="11" r="3"/>
        </svg>
      </div>
      <div class="fg-shield-badge">
        <span>🛡️</span> Focus Shield Active
      </div>
      <h2 class="fg-shield-title">Deep Focus In Progress</h2>
      <p class="fg-shield-desc">
        Access to <span class="fg-shield-domain">${hostname}</span> (${info.category || "Distraction"}) is shielded to maintain your uninterrupted attention flow.
      </p>
      <div class="fg-shield-actions">
        <button class="fg-shield-btn-primary" id="fgReturnHomeBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Return to FocusGuard Dashboard
        </button>
        <button class="fg-shield-btn-secondary" id="fgEmergencyBreakBtn">
          Take 2-Minute Emergency Override
        </button>
      </div>
    </div>
  `;

  document.documentElement.appendChild(overlay);

  // Return to Dashboard action
  document.getElementById("fgReturnHomeBtn")?.addEventListener("click", () => {
    window.location.href = "http://127.0.0.1:8000/";
  });

  // Emergency 2-minute snooze action
  document.getElementById("fgEmergencyBreakBtn")?.addEventListener("click", () => {
    const snoozeUntil = Date.now() + 2 * 60 * 1000;
    try {
      sessionStorage.setItem("fg_shield_snooze_" + hostname, String(snoozeUntil));
    } catch (e) {}
    removeShieldOverlay();
  });
}

function evaluateFocusShield() {
  const hostname = window.location.hostname;
  if (hostname === "127.0.0.1" || hostname === "localhost") return;

  const snoozeUntil = sessionStorage.getItem("fg_shield_snooze_" + hostname);
  if (snoozeUntil && Date.now() < parseInt(snoozeUntil, 10)) {
    return;
  }

  let title = document.title;
  let channel = "";
  if (hostname.includes("youtube.com")) {
    const ytm = getYouTubeMetadata();
    if (ytm) {
      title = ytm.title;
      channel = ytm.channel;
    }
  }

  chrome.runtime.sendMessage({
    type: "CHECK_SHIELD_STATUS",
    url: window.location.href,
    title: title,
    channel: channel
  }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.shouldBlock) {
      injectShieldOverlay(res);
    } else {
      removeShieldOverlay();
    }
  });
}

// Initial shield check
evaluateFocusShield();
setInterval(evaluateFocusShield, 4000);

// Dynamic YouTube SPA metadata extractor
function getYouTubeMetadata() {
  if (!window.location.hostname.includes("youtube.com")) return null;

  let title = document.title;
  const titleElem = document.querySelector("h1.ytd-watch-metadata yt-formatted-string") || document.querySelector("#title h1");
  if (titleElem && titleElem.textContent) {
    title = titleElem.textContent.trim();
  }

  let channel = "";
  const channelElem = document.querySelector("#channel-name a") || document.querySelector("ytd-channel-name a");
  if (channelElem && channelElem.textContent) {
    channel = channelElem.textContent.trim();
  }

  return {
    url: window.location.href,
    title: title,
    channel: channel
  };
}

// Listen for YouTube Single Page Navigation events
window.addEventListener("yt-navigate-finish", () => {
  setTimeout(() => {
    const meta = getYouTubeMetadata();
    if (meta) {
      chrome.runtime.sendMessage({
        type: "YOUTUBE_NAVIGATED",
        data: meta
      }).catch(() => {});
    }
    evaluateFocusShield();
  }, 1000);
});

// Initial load check if starting on YouTube
if (window.location.hostname.includes("youtube.com")) {
  setTimeout(() => {
    const meta = getYouTubeMetadata();
    if (meta) {
      chrome.runtime.sendMessage({
        type: "YOUTUBE_NAVIGATED",
        data: meta
      }).catch(() => {});
    }
    evaluateFocusShield();
  }, 1500);
}
