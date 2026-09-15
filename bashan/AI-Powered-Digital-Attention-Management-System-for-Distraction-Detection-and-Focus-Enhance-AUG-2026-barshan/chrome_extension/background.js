importScripts("classifiers/url_classifier.js", "api_client.js");

let activeTabId = null;
let currentDomain = null;
let currentUrl = null;
let currentTitle = null;
let currentChannel = null;
let currentCategory = null;
let tabStartTime = Date.now();
let isUserIdle = false;

function isInternalOrSystemUrl(url, domain) {
  if (!url || !domain) return true;
  if (url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("chrome-extension://") || url.startsWith("about:")) return true;
  if (domain === "localhost" || domain === "127.0.0.1" || domain.endsWith(".local")) return true;
  return false;
}

function recordCurrentTabDuration() {
  if (isInternalOrSystemUrl(currentUrl, currentDomain)) {
    return null;
  }

  const durationSecs = Math.round((Date.now() - tabStartTime) / 1000);
  if (durationSecs < 1) return null;

  const classification = classifyDomain(currentDomain, currentTitle, currentUrl, currentChannel);
  currentCategory = classification.category;

  const logEntry = {
    url: (currentUrl || "").slice(0, 1024),
    domain: currentDomain,
    page_title: (currentTitle || currentDomain || "").slice(0, 512),
    visited_at: new Date(tabStartTime).toISOString(),
    time_spent_secs: durationSecs,
    category: classification.category,
    productivity_label: classification.productivity_label,
    confidence_score: classification.confidence_score
  };

  // Dispatch immediately for real-time live telemetry
  sendBrowsingLog(logEntry).catch(e => console.error("Telemetry send failed:", e));

  return {
    domain: currentDomain,
    title: currentTitle || currentDomain,
    category: classification.category
  };
}

function sendSwitchEvent(fromInfo, toUrl, toTitle) {
  const toDomain = extractDomain(toUrl);
  if (!fromInfo || isInternalOrSystemUrl(toUrl, toDomain)) return;
  if (!toDomain || toDomain === fromInfo.domain) return; // same domain, not a real switch

  const toClassification = classifyDomain(toDomain, toTitle, toUrl, "");

  const switchData = {
    from_domain: fromInfo.domain,
    from_title: (fromInfo.title || "").slice(0, 512),
    from_category: fromInfo.category,
    to_domain: toDomain,
    to_title: (toTitle || toDomain || "").slice(0, 512),
    to_category: toClassification.category,
    switched_at: new Date().toISOString()
  };

  sendSwitchLog(switchData).catch(e => console.error("Switch event send failed:", e));
}

let isSessionActive = false;
let customBlockedDomains = [];

async function checkActiveSessionStatus() {
  try {
    const res = await authenticatedFetch("/focus/active/");
    if (res.ok) {
      const data = await res.json();
      isSessionActive = !!data.active;
      await chrome.storage.local.set({ isSessionActive });
      return isSessionActive;
    }
  } catch (e) {}
  const stored = await chrome.storage.local.get(["isSessionActive"]);
  isSessionActive = !!stored.isSessionActive;
  return isSessionActive;
}

async function checkCustomBlocklist() {
  try {
    const res = await authenticatedFetch("/focus/blocklist/");
    if (res.ok) {
      const data = await res.json();
      customBlockedDomains = (data.blocked_domains || []).map(d => d.toLowerCase());
      await chrome.storage.local.set({ customBlockedDomains });
      return customBlockedDomains;
    }
  } catch (e) {}
  const stored = await chrome.storage.local.get(["customBlockedDomains"]);
  customBlockedDomains = stored.customBlockedDomains || [];
  return customBlockedDomains;
}

// Initial sync of session status & blocklist
checkActiveSessionStatus().catch(() => {});
checkCustomBlocklist().catch(() => {});
setInterval(checkActiveSessionStatus, 15000);
setInterval(checkCustomBlocklist, 30000);

// Listen to messages from content scripts (YouTube navigation + Token sync + Shield queries)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SYNC_AUTH_TOKEN" && message.token) {
    chrome.storage.local.set({
      jwtAccessToken: message.token,
      jwtRefreshToken: message.refresh || ""
    });
    checkCustomBlocklist().catch(() => {});
    console.log("FocusGuard: Auto-synced auth token from Web App!");
    return;
  }

  if (message.type === "SET_SESSION_STATUS") {
    isSessionActive = !!message.active;
    chrome.storage.local.set({ isSessionActive });
    return;
  }

  if (message.type === "CHECK_SHIELD_STATUS") {
    checkActiveSessionStatus().then(async active => {
      if (!active) {
        sendResponse({ shouldBlock: false, reason: "No active focus session" });
        return;
      }
      const domain = extractDomain(message.url);
      if (!domain || isInternalOrSystemUrl(message.url, domain)) {
        sendResponse({ shouldBlock: false, reason: "Internal or system URL" });
        return;
      }
      if (!customBlockedDomains.length) {
        await checkCustomBlocklist();
      }
      const isCustomBlocked = customBlockedDomains.some(d => domain.includes(d) || d.includes(domain));
      const classification = classifyDomain(domain, message.title || "", message.url, message.channel || "");
      if (isCustomBlocked || classification.productivity_label === "DISTRACTING") {
        sendResponse({
          shouldBlock: true,
          domain: domain,
          title: message.title,
          category: classification.category || "Blocked",
          reason: "Distracting content or user-blocked site during active focus session"
        });
      } else {
        sendResponse({ shouldBlock: false, category: classification.category });
      }
    }).catch(err => {
      sendResponse({ shouldBlock: false, error: err.message });
    });
    return true; // Keep message channel open for async sendResponse
  }

  if (message.type === "YOUTUBE_NAVIGATED" && message.data) {
    const fromInfo = recordCurrentTabDuration();
    tabStartTime = Date.now();
    const prevUrl = currentUrl;
    currentUrl = message.data.url;
    currentDomain = "youtube.com";
    currentTitle = message.data.title;
    currentChannel = message.data.channel;

    // Record switch if URL genuinely changed
    if (fromInfo && message.data.url !== prevUrl) {
      sendSwitchEvent(fromInfo, message.data.url, message.data.title);
    }
  }
});

// Tab switched
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const fromInfo = recordCurrentTabDuration();

  activeTabId = activeInfo.tabId;
  tabStartTime = Date.now();

  try {
    const tab = await chrome.tabs.get(activeTabId);
    if (tab && tab.url) {
      // Send switch event before updating current state
      if (fromInfo) {
        sendSwitchEvent(fromInfo, tab.url, tab.title);
      }
      currentUrl = tab.url;
      currentDomain = extractDomain(tab.url);
      currentTitle = tab.title;
    }
  } catch (e) {
    // Tab might have been closed immediately
  }
});

// URL changed within same tab (navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === activeTabId && changeInfo.url) {
    const fromInfo = recordCurrentTabDuration();
    tabStartTime = Date.now();

    if (fromInfo) {
      sendSwitchEvent(fromInfo, changeInfo.url, tab.title);
    }

    currentUrl = changeInfo.url;
    currentDomain = extractDomain(changeInfo.url);
    currentTitle = tab.title;
  }
});

// Idle state detection (10 minutes = 600 seconds limit)
try {
  chrome.idle.setDetectionInterval(600);
} catch (e) {}

chrome.idle.onStateChanged.addListener((state) => {
  if (state === "idle" || state === "locked") {
    isUserIdle = true;
    recordCurrentTabDuration();
  } else if (state === "active") {
    isUserIdle = false;
    tabStartTime = Date.now();
  }
});

// Heartbeat: record time on active tab every 5 seconds so ongoing sessions appear live
setInterval(async () => {
  if (activeTabId && !isUserIdle) {
    try {
      const tab = await chrome.tabs.get(activeTabId);
      if (tab && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://")) {
        currentUrl = tab.url;
        currentDomain = extractDomain(tab.url);
        currentTitle = tab.title;
        recordCurrentTabDuration();
        tabStartTime = Date.now();
      }
    } catch (e) {}
  }
}, 5000);
