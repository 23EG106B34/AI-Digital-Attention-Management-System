/**
 * FocusGuard AI – Human Attention Preservation & Digital Distraction Intelligence Platform
 * Background Service Worker (Manifest V3)
 *
 * Core Responsibilities:
 * 1. Active Domain Detection: Detects normalized web domains (HTTP/HTTPS only).
 * 2. Session Tracking: Tracks browsing duration per domain and outputs Team 2 JSON records.
 * 3. Switch Tracking: Records domain switch events (from -> to) with timestamps.
 * 4. 1-Hour Switch Window: Tracks switch counts in fixed 1-hour windows (e.g. 09:00-10:00).
 * 5. Distraction Classification: Evaluates productivity (< 10 Productive, 10 Neutral, > 10 Distracted).
 * 6. Popup Focus Preservation: Prevents popup opens from terminating sessions or creating fake switches.
 */

/* ==========================================================================
   1. Constants & Configuration
   ========================================================================== */

// Maximum completed sessions retained in local storage (FIFO buffer)
const MAX_SESSIONS = 500;

// Maximum switch events retained in local storage (FIFO buffer)
const MAX_SWITCH_EVENTS = 500;

// Maximum historical hourly summaries retained in local storage (FIFO buffer)
const MAX_HOURLY_SUMMARIES = 100;

// Prototype distraction threshold for 1-hour switch window
const SWITCH_THRESHOLD = 10;

// Curated domain registry for Phase 6 classification
const DOMAIN_CATEGORIES = {
  'github.com': 'educational',
  'stackoverflow.com': 'educational',
  'coursera.org': 'educational',
  'udemy.com': 'educational',
  'instagram.com': 'non_educational',
  'netflix.com': 'non_educational',
  'youtube.com': 'unknown'
};

// Phase 7A Dynamic Classification Cache Configuration
const MAX_CACHE_ENTRIES = 2000;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds (2,592,000,000 ms)
const CACHE_STORAGE_KEY = 'domain_classification_cache';

// Phase 7B Resolver Server Configuration
const RESOLVER_ENDPOINT = 'http://127.0.0.1:8000/classify-domain';
const RESOLVER_TIMEOUT_MS = 3000; // 3-second non-blocking timeout

// Sleep / Idle / Suspend Protection Configuration
const SLEEP_GAP_THRESHOLD_MS = 60 * 1000; // 60-second conservative threshold for sleep/suspend gap detection
const HEARTBEAT_INTERVAL_MS = 10 * 1000; // 10-second active heartbeat interval

// In-memory domain classification cache mirror
let domainClassificationCache = {};

// In-flight pending domain resolution map (domain -> Promise) to deduplicate simultaneous requests
const pendingDomainResolutions = new Map();

// Active pluggable asynchronous domain resolver
let activeDomainResolver = null;

// In-memory active session reference (mirrored to chrome.storage.local)
let currentSession = null;

// In-memory last active domain reference to accurately track transitions
let lastActiveDomain = null;

// Sequential promise queue to prevent race conditions during rapid async events
let sessionMutex = Promise.resolve();

/* ==========================================================================
   2. Concurrency Lock
   ========================================================================== */

/**
 * Sequential lock wrapper to guarantee atomic session transitions.
 * Prevents overlapping async events from corrupting active session state.
 *
 * @param {Function} fn - Async callback to execute inside the lock.
 * @returns {Promise<any>}
 */
function withSessionLock(fn) {
  const result = sessionMutex.then(async () => {
    return await fn();
  });
  sessionMutex = result.catch((err) => {
    console.error('[FocusGuard Lock Error]', err);
  });
  return result;
}

/* ==========================================================================
   3. Domain & URL Helper Functions
   ========================================================================== */

/**
 * Safely extracts the lowercase hostname from a URL.
 * Ignores internal browser schemes (chrome://, edge://, about:blank, etc.)
 *
 * @param {string} url - Full URL string to parse.
 * @returns {string|null} - Hostname (e.g., 'www.youtube.com') or null if invalid/internal.
 */
function getDomainFromUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsedUrl = new URL(url);

    // Only track standard HTTP and HTTPS web traffic
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }

    return parsedUrl.hostname ? parsedUrl.hostname.toLowerCase() : null;
  } catch (error) {
    // Malformed URL or non-standard protocol
    return null;
  }
}

/**
 * Normalizes a hostname by removing leading 'www.' prefix.
 *
 * Examples:
 * - 'www.youtube.com' -> 'youtube.com'
 * - 'github.com'      -> 'github.com'
 *
 * @param {string} hostname - Raw hostname.
 * @returns {string|null} - Normalized domain name.
 */
function normalizeDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    return null;
  }

  const cleanHost = hostname.trim().toLowerCase();
  if (cleanHost.startsWith('www.')) {
    return cleanHost.slice(4);
  }
  return cleanHost;
}

/**
 * Sanitizes a URL for privacy by retaining protocol, host, and pathname only.
 * Strips query parameters, tokens, and hash fragments.
 *
 * @param {string} rawUrl - Full URL string.
 * @returns {string|null} - Sanitized URL or null.
 */
function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch (e) {
    return null;
  }
}

/**
 * Loads and initializes the domain classification cache from chrome.storage.local.
 * Automatically purges expired entries upon startup.
 *
 * @param {number} [now=Date.now()] - Current epoch timestamp in milliseconds.
 * @returns {Promise<Object>} - In-memory cache map.
 */
async function loadClassificationCache(now = Date.now()) {
  try {
    const data = await chrome.storage.local.get([CACHE_STORAGE_KEY]);
    const rawCache = data[CACHE_STORAGE_KEY] || {};
    domainClassificationCache = {};

    let hasExpired = false;
    for (const [domain, entry] of Object.entries(rawCache)) {
      if (entry && entry.category && typeof entry.timestamp === 'number') {
        const ttl = typeof entry.ttl === 'number' ? entry.ttl : CACHE_TTL_MS;
        if (now - entry.timestamp < ttl) {
          domainClassificationCache[domain] = entry;
        } else {
          hasExpired = true;
        }
      }
    }

    if (hasExpired) {
      await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: domainClassificationCache });
    }

    return domainClassificationCache;
  } catch (err) {
    console.error('[FocusGuard] Error loading classification cache:', err);
    return domainClassificationCache;
  }
}

/**
 * Retrieves a cached category for a domain if present and not expired.
 * Supports subdomain fallback in cache.
 *
 * @param {string} domain - Normalized domain.
 * @param {number} [now=Date.now()] - Current timestamp.
 * @returns {string|null} - Cached category ('educational'|'non_educational'|'unknown') or null.
 */
function getCachedDomainCategory(domain, now = Date.now()) {
  if (!domain || typeof domain !== 'string') return null;
  const clean = domain.trim().toLowerCase();

  // 1. Direct domain match in cache
  const direct = domainClassificationCache[clean];
  if (direct && direct.category && typeof direct.timestamp === 'number') {
    const ttl = typeof direct.ttl === 'number' ? direct.ttl : CACHE_TTL_MS;
    if (now - direct.timestamp < ttl) {
      return direct.category;
    }
  }

  // 2. Subdomain fallback in cache (e.g. docs.somedomain.org -> somedomain.org)
  const parts = clean.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    const parentEntry = domainClassificationCache[parent];
    if (parentEntry && parentEntry.category && typeof parentEntry.timestamp === 'number') {
      const ttl = typeof parentEntry.ttl === 'number' ? parentEntry.ttl : CACHE_TTL_MS;
      if (now - parentEntry.timestamp < ttl) {
        return parentEntry.category;
      }
    }
  }

  return null;
}

/**
 * Stores a domain classification in memory and syncs to chrome.storage.local,
 * enforcing maximum capacity (2,000 items) via FIFO/LRU eviction.
 *
 * @param {string} domain - Normalized domain.
 * @param {'educational'|'non_educational'|'unknown'} category - Valid category.
 * @param {Object} [options={}] - Optional metadata (timestamp, ttl, confidence, source).
 * @returns {Promise<Object>} - Updated cache entry.
 */
async function setCachedDomainCategory(domain, category, options = {}) {
  if (!domain || typeof domain !== 'string') return null;
  const clean = domain.trim().toLowerCase();

  const validCategories = ['educational', 'non_educational', 'unknown'];
  const targetCategory = validCategories.includes(category) ? category : 'unknown';

  const entry = {
    domain: clean,
    category: targetCategory,
    timestamp: typeof options.timestamp === 'number' ? options.timestamp : Date.now(),
    ttl: typeof options.ttl === 'number' ? options.ttl : CACHE_TTL_MS,
    confidence: typeof options.confidence === 'number' ? options.confidence : 1.0,
    source: options.source || 'cache'
  };

  domainClassificationCache[clean] = entry;

  // Enforce MAX_CACHE_ENTRIES limit (2,000 max entries)
  const keys = Object.keys(domainClassificationCache);
  if (keys.length > MAX_CACHE_ENTRIES) {
    const sorted = Object.values(domainClassificationCache).sort((a, b) => a.timestamp - b.timestamp);
    const toKeep = sorted.slice(sorted.length - MAX_CACHE_ENTRIES);
    domainClassificationCache = {};
    for (const item of toKeep) {
      domainClassificationCache[item.domain] = item;
    }
  }

  try {
    await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: domainClassificationCache });
  } catch (err) {
    console.error('[FocusGuard] Error saving classification cache:', err);
  }

  return entry;
}

/**
 * Purges expired cache entries from memory and storage.
 *
 * @param {number} [now=Date.now()]
 * @returns {Promise<number>} - Count of purged entries.
 */
async function purgeExpiredCache(now = Date.now()) {
  let purgedCount = 0;
  const updatedCache = {};

  for (const [domain, entry] of Object.entries(domainClassificationCache)) {
    if (entry && entry.timestamp) {
      const ttl = typeof entry.ttl === 'number' ? entry.ttl : CACHE_TTL_MS;
      if (now - entry.timestamp < ttl) {
        updatedCache[domain] = entry;
      } else {
        purgedCount++;
      }
    }
  }

  domainClassificationCache = updatedCache;
  if (purgedCount > 0) {
    try {
      await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: domainClassificationCache });
    } catch (e) {}
  }
  return purgedCount;
}

/**
 * Network resolver connector that asynchronously queries the local FastAPI resolver service.
 * Enforces 3-second non-blocking timeout, payload validation, and graceful offline fallback.
 *
 * @param {string} domain - Normalized domain string.
 * @returns {Promise<{ category: string, confidence: number, source: string }|null>}
 */
async function fetchDomainClassification(domain) {
  if (!domain || typeof domain !== 'string') return null;
  const clean = normalizeDomain(domain) || domain;

  let timeoutId = null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  if (controller) {
    timeoutId = setTimeout(() => {
      try {
        controller.abort();
      } catch (e) {}
    }, RESOLVER_TIMEOUT_MS);
  }

  try {
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ domain: clean })
    };
    if (controller) {
      fetchOptions.signal = controller.signal;
    }

    const response = await fetch(RESOLVER_ENDPOINT, fetchOptions);
    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok) {
      return { category: 'unknown', confidence: 0.0, source: `http_${response.status}` };
    }

    const data = await response.json();
    if (data && data.category) {
      const validCategories = ['educational', 'non_educational', 'unknown'];
      const rawCat = validCategories.includes(data.category) ? data.category : 'unknown';
      const confidence = typeof data.confidence === 'number' ? data.confidence : 0.0;
      const finalCat = confidence >= 0.80 ? rawCat : 'unknown';

      return {
        category: finalCat,
        confidence: confidence,
        source: data.source || 'server_domain_db'
      };
    }
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    // Silent graceful fallback for network errors / server offline / timeout
    return { category: 'unknown', confidence: 0.0, source: 'network_fallback' };
  }

  return null;
}

// Initialize default active domain resolver with local FastAPI connector
activeDomainResolver = fetchDomainClassification;

/**
 * Registers an asynchronous resolver function for unlisted domains.
 * The resolver function signature must be: async (domain) => { category, confidence, source }
 *
 * @param {Function|null} resolverFn
 */
function registerDomainResolver(resolverFn) {
  if (typeof resolverFn === 'function' || resolverFn === null) {
    activeDomainResolver = resolverFn;
  }
}

/**
 * Triggers the registered asynchronous resolver in the background for an unlisted domain.
 * Does not block synchronous session initialization.
 * Deduplicates in-flight requests using a shared promise map.
 * Upon successful resolution, saves the category to local cache.
 *
 * @param {string} domain - Normalized domain.
 * @returns {Promise<string|null>} - Resolved category or null.
 */
async function resolveUnknownDomainAsync(domain) {
  if (!activeDomainResolver || typeof activeDomainResolver !== 'function') {
    return null;
  }
  if (!domain || typeof domain !== 'string') {
    return null;
  }

  const clean = normalizeDomain(domain) || domain;

  // Deduplicate concurrent in-flight requests for the same domain
  if (pendingDomainResolutions.has(clean)) {
    return await pendingDomainResolutions.get(clean);
  }

  const resolutionPromise = (async () => {
    try {
      const result = await activeDomainResolver(clean);
      if (result && result.category) {
        const validCategories = ['educational', 'non_educational', 'unknown'];
        const cat = validCategories.includes(result.category) ? result.category : 'unknown';
        await setCachedDomainCategory(clean, cat, {
          confidence: result.confidence,
          source: result.source || 'async_resolver'
        });
        return cat;
      }
    } catch (err) {
      console.warn('[FocusGuard] Async domain resolver error for', domain, err);
    } finally {
      pendingDomainResolutions.delete(clean);
    }
    return 'unknown';
  })();

  pendingDomainResolutions.set(clean, resolutionPromise);
  return await resolutionPromise;
}

/**
 * Classifies a domain into 'educational', 'non_educational', or 'unknown'
 * using the Tiered Hybrid Architecture:
 * 1. Tier 1: Static curated registry (DOMAIN_CATEGORIES)
 * 2. Tier 2: Local storage classification cache (chrome.storage.local, 30-day TTL)
 * 3. Tier 3: Asynchronous background resolver trigger (non-blocking)
 * 4. Fallback: "unknown"
 *
 * @param {string} domainOrUrl - Raw domain, hostname, or full URL.
 * @returns {'educational'|'non_educational'|'unknown'}
 */
function classifyDomain(domainOrUrl) {
  if (!domainOrUrl || typeof domainOrUrl !== 'string') {
    return 'unknown';
  }

  let cleanDomain = domainOrUrl.trim().toLowerCase();

  // If a full URL is provided, extract normalized domain
  if (cleanDomain.includes('://') || cleanDomain.startsWith('http')) {
    const extracted = getDomainFromUrl(cleanDomain);
    cleanDomain = normalizeDomain(extracted) || cleanDomain;
  } else {
    cleanDomain = normalizeDomain(cleanDomain) || cleanDomain;
  }

  // 1. Direct static registry lookup (Tier 1)
  if (Object.prototype.hasOwnProperty.call(DOMAIN_CATEGORIES, cleanDomain)) {
    return DOMAIN_CATEGORIES[cleanDomain];
  }

  // 2. Subdomain resolution in registry (e.g. docs.github.com -> github.com)
  const parts = cleanDomain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parentDomain = parts.slice(i).join('.');
    if (Object.prototype.hasOwnProperty.call(DOMAIN_CATEGORIES, parentDomain)) {
      return DOMAIN_CATEGORIES[parentDomain];
    }
  }

  // 3. Local Cache lookup (Tier 2)
  const cachedCategory = getCachedDomainCategory(cleanDomain);
  if (cachedCategory) {
    return cachedCategory;
  }

  // 4. Trigger asynchronous resolver in background if available (non-blocking)
  if (activeDomainResolver) {
    resolveUnknownDomainAsync(cleanDomain).catch(() => {});
  }

  // 5. Unlisted / unknown domain fallback
  return 'unknown';
}

/**
 * Asynchronously classifies a domain, awaiting dynamic resolution if unlisted.
 *
 * @param {string} domainOrUrl
 * @returns {Promise<'educational'|'non_educational'|'unknown'>}
 */
async function classifyDomainAsync(domainOrUrl) {
  if (!domainOrUrl || typeof domainOrUrl !== 'string') {
    return 'unknown';
  }

  let cleanDomain = domainOrUrl.trim().toLowerCase();
  if (cleanDomain.includes('://') || cleanDomain.startsWith('http')) {
    const extracted = getDomainFromUrl(cleanDomain);
    cleanDomain = normalizeDomain(extracted) || cleanDomain;
  } else {
    cleanDomain = normalizeDomain(cleanDomain) || cleanDomain;
  }

  // 1. Direct static registry lookup (Tier 1)
  if (Object.prototype.hasOwnProperty.call(DOMAIN_CATEGORIES, cleanDomain)) {
    return DOMAIN_CATEGORIES[cleanDomain];
  }

  // 2. Subdomain resolution in registry
  const parts = cleanDomain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parentDomain = parts.slice(i).join('.');
    if (Object.prototype.hasOwnProperty.call(DOMAIN_CATEGORIES, parentDomain)) {
      return DOMAIN_CATEGORIES[parentDomain];
    }
  }

  // 3. Local Cache lookup (Tier 2)
  const cachedCategory = getCachedDomainCategory(cleanDomain);
  if (cachedCategory) {
    return cachedCategory;
  }

  // 4. Asynchronous resolver execution
  if (activeDomainResolver) {
    const resolved = await resolveUnknownDomainAsync(cleanDomain);
    if (resolved) {
      return resolved;
    }
  }

  return 'unknown';
}

/* ==========================================================================
   4. Time & Classification Helper Functions
   ========================================================================== */

/**
 * Returns the fixed 1-hour window string for a given date in local time.
 * Examples: '09:00-10:00', '10:00-11:00', '23:00-00:00'
 *
 * @param {Date|string|number} [dateInput=new Date()]
 * @returns {string}
 */
function getCurrentHourWindow(dateInput = new Date()) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    return '00:00-01:00';
  }
  const startHour = d.getHours();
  const endHour = (startHour + 1) % 24;
  const pad = (num) => String(num).padStart(2, '0');
  return `${pad(startHour)}:00-${pad(endHour)}:00`;
}

// Phase 9 Distraction Notification Configuration
const NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000; // 15-minute prototype cooldown (900,000 ms)
const NOTIFICATION_STORAGE_KEY = 'last_distraction_notification';

/**
 * Previous distraction state for detecting state transitions (e.g., productive -> distracted)
 * Used as the primary notification trigger in Phase 9.
 */
let lastDistractionState = 'productive';

/**
 * Checks for a distraction state transition.
 * Returns true if state transitioned from non-distracted (productive/neutral) to distracted.
 *
 * @param {string} newState - 'productive' | 'neutral' | 'distracted'
 * @returns {boolean} - True if transition occurred to distracted.
 */
function checkDistractionTransition(newState) {
  const previous = lastDistractionState;
  lastDistractionState = newState;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ lastDistractionState: newState }).catch(() => {});
    }
  } catch (e) {}
  return (previous === 'productive' || previous === 'neutral') && newState === 'distracted';
}

/**
 * Sends a Chrome browser notification if cooldown period (15 minutes) has elapsed.
 * Stores the notification timestamp in chrome.storage.local.
 *
 * @param {number} [now=Date.now()] - Current epoch timestamp.
 * @returns {Promise<boolean>} - True if notification was dispatched, false if suppressed by cooldown.
 */
async function sendDistractionNotification(now = Date.now()) {
  try {
    const data = await chrome.storage.local.get([NOTIFICATION_STORAGE_KEY]);
    const lastNotif = typeof data[NOTIFICATION_STORAGE_KEY] === 'number' ? data[NOTIFICATION_STORAGE_KEY] : 0;

    if (now - lastNotif < NOTIFICATION_COOLDOWN_MS) {
      console.log(`[FocusGuard] Distraction notification suppressed by cooldown (${Math.round((NOTIFICATION_COOLDOWN_MS - (now - lastNotif)) / 1000)}s remaining)`);
      return false;
    }

    if (typeof chrome !== 'undefined' && chrome.notifications && typeof chrome.notifications.create === 'function') {
      const iconUrl = (typeof chrome.runtime !== 'undefined' && typeof chrome.runtime.getURL === 'function')
        ? chrome.runtime.getURL('icons/icon48.png')
        : 'icons/icon48.png';

      const notifOptions = {
        type: 'basic',
        iconUrl: iconUrl,
        title: 'FocusGuard AI',
        message: 'You may be getting distracted. Take a moment to refocus.',
        priority: 2,
        requireInteraction: false
      };

      await new Promise((resolve) => {
        try {
          chrome.notifications.create(`fg_distraction_${now}`, notifOptions, (notificationId) => {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
              console.warn('[FocusGuard] Notification create warning:', chrome.runtime.lastError.message);
            }
            resolve(notificationId);
          });
        } catch (e) {
          if (chrome.notifications.create.length <= 2) {
            chrome.notifications.create(`fg_distraction_${now}`, notifOptions).then(resolve).catch(resolve);
          } else {
            resolve(null);
          }
        }
      });
    }

    await chrome.storage.local.set({ [NOTIFICATION_STORAGE_KEY]: now });
    console.log('[FocusGuard] Distraction notification triggered successfully.');
    return true;
  } catch (err) {
    console.warn('[FocusGuard] Failed to send distraction notification:', err);
    return false;
  }
}

/**
 * Evaluates current state and dispatches a notification only on leading-edge transition to DISTRACTED.
 *
 * @param {Object} context
 * @param {number} [now=Date.now()]
 * @returns {Promise<{ distractionInfo: Object, notificationSent: boolean, isTransition: boolean }>}
 */
async function evaluateAndNotifyDistraction(context = {}, now = Date.now()) {
  const distractionInfo = calculateDistractionState(context);
  const isTransition = checkDistractionTransition(distractionInfo.state);
  let notificationSent = false;

  if (isTransition && distractionInfo.state === 'distracted') {
    notificationSent = await sendDistractionNotification(now);
  }

  return { distractionInfo, notificationSent, isTransition };
}

/**
 * Evaluates the current distraction / productivity state using a multi-signal rule system.
 *
 * Signals used:
 * 1. Current domain & category ('educational', 'non_educational', 'unknown')
 * 2. Hourly switch count (prototype threshold: < 10 productive/neutral, === 10 neutral, > 10 distracted)
 * 3. Active / Idle presence state (Idle alone is NOT distracted)
 * 4. Session duration & transition context
 *
 * @param {Object} context
 * @param {string} [context.domain] - Normalized domain name.
 * @param {'educational'|'non_educational'|'unknown'} [context.category] - Domain category.
 * @param {number} [context.switch_count=0] - Number of switches in current hourly window.
 * @param {boolean} [context.is_idle=false] - Whether user is currently idle.
 * @param {number} [context.duration=0] - Session duration in seconds.
 * @returns {{ state: 'productive'|'neutral'|'distracted', reason: string, switch_count: number }}
 */
function calculateDistractionState(context = {}) {
  const switchCount = typeof context.switch_count === 'number' ? Math.max(0, context.switch_count) : 0;
  const category = context.category || (context.domain ? classifyDomain(context.domain) : 'unknown');
  const isIdle = Boolean(context.is_idle);

  // 1. High switch frequency threshold (> 10 switches in 1 hour)
  if (switchCount > SWITCH_THRESHOLD) {
    return {
      state: 'distracted',
      reason: 'high_switch_frequency',
      switch_count: switchCount
    };
  }

  // 2. Exact prototype boundary (switch_count === 10)
  if (switchCount === SWITCH_THRESHOLD) {
    return {
      state: 'neutral',
      reason: 'threshold_boundary',
      switch_count: switchCount
    };
  }

  // 3. Low switch count (< 10 switches in 1 hour) - Domain & Category Evaluation
  if (category === 'educational') {
    return {
      state: 'productive',
      reason: isIdle ? 'idle_state' : 'educational_stable',
      switch_count: switchCount
    };
  }

  if (category === 'non_educational') {
    // Non-educational with low switches is NOT automatically distracted; evaluated as neutral
    return {
      state: 'neutral',
      reason: 'non_educational_usage',
      switch_count: switchCount
    };
  }

  // category === 'unknown' (e.g. youtube.com, reddit.com, unlisted sites)
  return {
    state: 'neutral',
    reason: isIdle ? 'idle_state' : 'unknown_domain',
    switch_count: switchCount
  };
}

/**
 * Classifies productivity based on prototype switch threshold:
 * - count < 10  -> 'productive'
 * - count === 10 -> 'neutral'
 * - count > 10  -> 'distracted'
 *
 * @param {number} count - Hourly switch count.
 * @returns {'productive'|'neutral'|'distracted'}
 */
function classifySwitchCount(count) {
  if (count < SWITCH_THRESHOLD) {
    return 'productive';
  }
  if (count === SWITCH_THRESHOLD) {
    return 'neutral';
  }
  return 'distracted';
}

/**
 * Formats a Date object or ISO timestamp string into 'HH:MM' (24-hour local time).
 * Example: '09:00', '14:30'
 *
 * @param {string|Date} dateInput
 * @returns {string}
 */
function formatTimeHHMM(dateInput) {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '00:00';
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch (e) {
    return '00:00';
  }
}

/**
 * Generates a unique, timestamped session identifier.
 *
 * @returns {string}
 */
function generateSessionId() {
  return 'fg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

/* ==========================================================================
   5. Storage & Hourly State Management
   ========================================================================== */

/**
 * Enforces maximum storage limits using FIFO (First-In, First-Out).
 * Keeps the most recent records and trims older entries.
 *
 * @param {Array} items - Array of items to bound.
 * @param {number} limit - Maximum number of items.
 * @returns {Array}
 */
function cleanupOldSessions(items, limit = MAX_SESSIONS) {
  if (!Array.isArray(items)) {
    return [];
  }
  if (items.length > limit) {
    return items.slice(0, limit);
  }
  return items;
}

/**
 * Retrieves the currently active session from memory or storage.
 *
 * @returns {Promise<Object|null>}
 */
async function getActiveSession() {
  if (currentSession !== null) {
    return currentSession;
  }
  try {
    const data = await chrome.storage.local.get(['currentSession']);
    currentSession = data.currentSession || null;
    return currentSession;
  } catch (error) {
    console.error('[FocusGuard] Error reading active session from storage:', error);
    return null;
  }
}

/**
 * Updates the active session in memory and syncs to chrome.storage.local.
 *
 * @param {Object|null} session
 */
async function setActiveSession(session) {
  currentSession = session;
  try {
    await chrome.storage.local.set({ currentSession: session });
  } catch (error) {
    console.error('[FocusGuard] Error writing active session to storage:', error);
  }
}

/**
 * Retrieves completed session history from storage.
 *
 * @returns {Promise<Array>}
 */
async function getStoredSessions() {
  try {
    const data = await chrome.storage.local.get(['sessions']);
    return Array.isArray(data.sessions) ? data.sessions : [];
  } catch (error) {
    console.error('[FocusGuard] Error reading sessions from storage:', error);
    return [];
  }
}

/**
 * Checks and synchronizes the fixed 1-hour window state.
 * If the hour rolled over, archives the completed hour summary and resets switch count to 0.
 *
 * @param {Date} [targetDate=new Date()]
 * @returns {Promise<{ current_hour: Object, hourly_summaries: Array }>}
 */
async function syncHourlyState(targetDate = new Date()) {
  try {
    const data = await chrome.storage.local.get(['current_hour', 'hourly_summaries']);
    const expectedWindow = getCurrentHourWindow(targetDate);
    let currentHour = data.current_hour;
    let summaries = Array.isArray(data.hourly_summaries) ? data.hourly_summaries : [];

    // Hour rollover check
    if (!currentHour || currentHour.hour !== expectedWindow) {
      if (currentHour && currentHour.hour && typeof currentHour.switch_count === 'number') {
        // Archive the previous hour summary to history
        summaries = cleanupOldSessions([currentHour, ...summaries], MAX_HOURLY_SUMMARIES);
      }
      currentHour = {
        hour: expectedWindow,
        switch_count: 0,
        classification: classifySwitchCount(0)
      };
      lastDistractionState = 'productive';
      await chrome.storage.local.set({
        current_hour: currentHour,
        switch_count: 0,
        hourly_summaries: summaries,
        lastDistractionState: 'productive'
      });
    }

    return { current_hour: currentHour, hourly_summaries: summaries };
  } catch (error) {
    console.error('[FocusGuard] Error syncing hourly state:', error);
    return {
      current_hour: { hour: getCurrentHourWindow(targetDate), switch_count: 0, classification: 'productive' },
      hourly_summaries: []
    };
  }
}

/* ==========================================================================
   6. Session Tracking & Switch Recording
   ========================================================================== */

/**
 * Records a genuine domain switch event (previousDomain !== toDomain),
 * increments the 1-hour switch counter, and persists to storage.
 *
 * @param {string} fromDomain - Normalized domain switched from.
 * @param {string} toDomain - Normalized domain switched to.
 * @param {Date} [eventDate=new Date()] - Date of the switch event.
 */
async function recordSwitchEvent(fromDomain, toDomain, eventDate = new Date()) {
  if (!fromDomain || !toDomain || fromDomain === toDomain) {
    return;
  }

  const timestampIso = new Date(eventDate).toISOString();
  const switchEvent = {
    from: fromDomain,
    to: toDomain,
    from_category: classifyDomain(fromDomain),
    to_category: classifyDomain(toDomain),
    timestamp: timestampIso
  };

  try {
    // Synchronize hourly window before updating count
    const { current_hour } = await syncHourlyState(eventDate);
    const data = await chrome.storage.local.get(['switch_events']);
    const existingEvents = Array.isArray(data.switch_events) ? data.switch_events : [];

    const newSwitchCount = (current_hour.switch_count || 0) + 1;
    const updatedCurrentHour = {
      hour: current_hour.hour,
      switch_count: newSwitchCount,
      classification: classifySwitchCount(newSwitchCount)
    };

    // Prepend new switch event and bound with FIFO
    const updatedEvents = [switchEvent, ...existingEvents];
    const boundedEvents = cleanupOldSessions(updatedEvents, MAX_SWITCH_EVENTS);

    await chrome.storage.local.set({
      current_hour: updatedCurrentHour,
      switch_count: newSwitchCount,
      switch_events: boundedEvents,
      lastActiveDomain: toDomain
    });

    lastActiveDomain = toDomain;

    // Log formatted switch event to service-worker console
    console.log('[FocusGuard Switch Event]');
    console.log(JSON.stringify(switchEvent, null, 2));
    console.log('[FocusGuard Switch Count]', newSwitchCount);

    // A genuine browser transition is also sent to the existing Django API.
    // Local storage remains the offline fallback when no authenticated session exists.
    await uploadSwitchEvent(switchEvent);

    // Evaluate distraction state and trigger notification if transition occurred to DISTRACTED
    await evaluateAndNotifyDistraction({
      domain: toDomain,
      category: classifyDomain(toDomain),
      switch_count: newSwitchCount
    }, new Date(eventDate).getTime());
  } catch (error) {
    console.error('[FocusGuard] Error recording switch event:', error);
  }
}

async function uploadSwitchEvent(switchEvent) {
  const stored = await chrome.storage.local.get(['apiBaseUrl', 'jwtAccessToken']);
  if (!stored.jwtAccessToken) return;
  try {
    const response = await fetch(`${stored.apiBaseUrl || 'http://127.0.0.1:8000/api'}/browsing/switch/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${stored.jwtAccessToken}`,
        'X-Client-Type': 'chrome-extension'
      },
      body: JSON.stringify({
        from_domain: switchEvent.from,
        from_title: '',
        from_category: switchEvent.from_category,
        to_domain: switchEvent.to,
        to_title: '',
        to_category: switchEvent.to_category,
        switched_at: switchEvent.timestamp
      })
    });
    if (!response.ok) {
      console.warn('[FocusGuard] Switch sync rejected:', response.status);
    }
  } catch (error) {
    console.warn('[FocusGuard] Switch sync failed; event remains stored locally.', error);
  }
}

/**
 * Saves a completed session record to local storage with FIFO cleanup.
 *
 * @param {Object} session - Completed session record.
 */
async function saveSession(session) {
  if (!session || (!session.domain && !session.name)) {
    return;
  }

  try {
    const existingSessions = await getStoredSessions();
    const updatedSessions = [session, ...existingSessions];
    const boundedSessions = cleanupOldSessions(updatedSessions, MAX_SESSIONS);

    await chrome.storage.local.set({ sessions: boundedSessions });
    console.log('[FocusGuard] Session saved to storage successfully.');
  } catch (error) {
    console.error('[FocusGuard] Failed to save session to storage:', error);
  }
}

/**
 * Incrementally updates accumulated active browsing time for a session,
 * safely discarding sleep/suspend time gaps without relying solely on timers.
 *
 * @param {Object} session - Active session object.
 * @param {number|Date} [now=Date.now()] - Current epoch timestamp.
 * @returns {Object|null}
 */
function updateSessionActivity(session, now = Date.now()) {
  if (!session) return null;
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();

  // If session is paused (due to idle or lock), do not accumulate active duration
  if (session.isPaused) {
    return session;
  }

  const lastActive = typeof session.lastActiveTime === 'number'
    ? session.lastActiveTime
    : new Date(session.startTime || session.timestamp).getTime();

  const gap = nowMs - lastActive;

  if (gap > 0) {
    if (gap <= SLEEP_GAP_THRESHOLD_MS) {
      session.accumulatedActiveMs = (session.accumulatedActiveMs || 0) + gap;
    } else {
      // Abnormally large time gap detected (laptop sleep / suspend)
      console.log(`[FocusGuard] Sleep/suspend gap of ${Math.round(gap / 1000)}s excluded from session duration.`);
    }
  }

  session.lastActiveTime = nowMs;
  return session;
}

/**
 * Pauses an active browsing session when user or system becomes idle or locked.
 *
 * @param {number|Date} [now=Date.now()]
 * @param {string} [state='idle'] - 'idle' | 'locked'
 * @returns {Promise<Object|null>}
 */
async function pauseActiveSession(now = Date.now(), state = 'idle') {
  const active = await getActiveSession();
  if (!active) return null;

  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();
  updateSessionActivity(active, nowMs);
  active.isPaused = true;
  active.idleState = state;
  active.lastPauseTime = nowMs;

  await setActiveSession(active);
  console.log(`[FocusGuard] Session paused (${state}) at ${formatTimeHHMM(new Date(nowMs))}`);
  return active;
}

/**
 * Resumes an active browsing session when user or system returns to active state.
 *
 * @param {number|Date} [now=Date.now()]
 * @returns {Promise<Object|null>}
 */
async function resumeActiveSession(now = Date.now()) {
  const active = await getActiveSession();
  if (!active) return null;

  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();
  active.isPaused = false;
  active.idleState = 'active';
  active.lastActiveTime = nowMs;
  active.lastPauseTime = null;

  await setActiveSession(active);
  console.log(`[FocusGuard] Session resumed (active) at ${formatTimeHHMM(new Date(nowMs))}`);
  return active;
}

/**
 * Handles chrome.idle onStateChanged transitions ('active', 'idle', 'locked').
 *
 * @param {string} newState - 'active' | 'idle' | 'locked'
 * @param {number|Date} [now=Date.now()]
 */
async function handleIdleStateChange(newState, now = Date.now()) {
  console.log(`[FocusGuard] chrome.idle state transition: ${newState}`);
  if (newState === 'locked' || newState === 'idle') {
    await pauseActiveSession(now, newState);
  } else if (newState === 'active') {
    await resumeActiveSession(now);
  }
}

/**
 * Finalizes the currently active browsing session.
 * Calculates duration in seconds using internal timestamps,
 * generates the required Team 2 JSON record, logs to console, and saves to storage.
 *
 * @param {Date} [endDate=new Date()] - Timestamp when session ended.
 * @returns {Promise<Object|null>} - Completed session record or null.
 */
async function endSession(endDate = new Date()) {
  const active = await getActiveSession();
  if (!active || (!active.domain && !active.name)) {
    await setActiveSession(null);
    return null;
  }

  const endTimestamp = new Date(endDate);
  const endTimestampMs = endTimestamp.getTime();
  const endTimeIso = endTimestamp.toISOString();
  const startTimestamp = new Date(active.startTime || active.timestamp);
  const startTimestampMs = startTimestamp.getTime();

  // Update session active time up to endTimestamp
  updateSessionActivity(active, endTimestampMs);

  // Calculate accurate duration in seconds from active accumulation or single-shot window
  let rawDuration;
  if (typeof active.accumulatedActiveMs === 'number' && active.accumulatedActiveMs > 0) {
    rawDuration = Math.round(active.accumulatedActiveMs / 1000);
  } else if (active.isPaused && typeof active.accumulatedActiveMs === 'number') {
    rawDuration = Math.round(active.accumulatedActiveMs / 1000);
  } else {
    // Single-shot or continuous block
    const totalDeltaMs = endTimestampMs - startTimestampMs;
    if (totalDeltaMs > SLEEP_GAP_THRESHOLD_MS && active.lastActiveTime && active.lastActiveTime > startTimestampMs) {
      rawDuration = Math.round(Math.max(0, active.lastActiveTime - startTimestampMs) / 1000);
    } else {
      rawDuration = Math.round(totalDeltaMs / 1000);
    }
  }
  const durationSeconds = Math.max(1, rawDuration);
  const targetDomain = active.name || active.domain;
  const domainCategory = active.category || classifyDomain(targetDomain);

  // Generate required Team 2 Activity Record
  // Query hourly switch count to evaluate distraction state
  let currentSwitchCount = 0;
  try {
    const hourlyData = await chrome.storage.local.get(['current_hour']);
    if (hourlyData.current_hour && typeof hourlyData.current_hour.switch_count === 'number') {
      currentSwitchCount = hourlyData.current_hour.switch_count;
    }
  } catch (e) {}

  const distractionInfo = calculateDistractionState({
    domain: targetDomain,
    category: domainCategory,
    switch_count: currentSwitchCount,
    duration: durationSeconds
  });

  // Track state transitions and evaluate notification eligibility
  await evaluateAndNotifyDistraction({
    domain: targetDomain,
    category: domainCategory,
    switch_count: currentSwitchCount,
    duration: durationSeconds
  }, endTimestamp.getTime());

  // Generate required Team 2 Activity Record
  // The five required fields (source, name, start_time, end_time, duration) must not be renamed or removed.
  const completedSession = {
    // 5 BASIC / REQUIRED Team 2 output fields:
    source: 'extension',
    name: targetDomain,
    start_time: active.start_time || formatTimeHHMM(startTimestamp),
    end_time: formatTimeHHMM(endTimestamp),
    duration: durationSeconds,

    // Phase 6 domain category:
    category: domainCategory,

    // Phase 8 distraction detection state:
    distraction_state: distractionInfo.state,

    // Supplementary non-sensitive fields for backend integration and UI display:
    hostname: active.hostname || targetDomain,
    tab_id: active.tabId || active.tab_id,
    url: active.url || (active.hostname ? `https://${active.hostname}/` : null),
    timestamp: active.startTime || active.timestamp || startTimestamp.toISOString(),

    // UI & backward-compatibility fields:
    id: active.id || generateSessionId(),
    domain: targetDomain,
    startTime: active.startTime || startTimestamp.toISOString(),
    endTime: endTimeIso,
    durationSeconds: durationSeconds
  };

  // Log Team 2 JSON record to service-worker console
  console.log('[Team 2 Activity Record Generated]');
  console.log(JSON.stringify(completedSession, null, 2));

  // Persist completed session to storage and reset active session
  await saveSession(completedSession);
  // Optional authenticated sync: local tracking remains available while offline.
  await uploadCompletedSession(completedSession);
  await setActiveSession(null);

  return completedSession;
}

async function uploadCompletedSession(session) {
  const stored = await chrome.storage.local.get(['apiBaseUrl', 'jwtAccessToken']);
  if (!stored.jwtAccessToken) return;
  const category = session.category === 'educational' ? 'EDUCATION' : session.category === 'non_educational' ? 'ENTERTAINMENT' : 'SYSTEM';
  const productivity_label = session.distraction_state === 'productive' ? 'PRODUCTIVE' : session.distraction_state === 'distracted' ? 'DISTRACTING' : 'NEUTRAL';
  try {
    await fetch(`${stored.apiBaseUrl || 'http://127.0.0.1:8000/api'}/browsing/log/`, {
      method: 'POST', headers: {'Content-Type':'application/json', 'Authorization':`Bearer ${stored.jwtAccessToken}`},
      body: JSON.stringify({url: session.url || `https://${session.hostname}`, domain: session.hostname, page_title: session.name, visited_at: session.startTime, time_spent_secs: session.duration, category, productivity_label, confidence_score: 1})
    });
  } catch (error) { console.warn('[FocusGuard] Backend sync failed; session remains stored locally.', error); }
}

/**
 * Starts a new active browsing session for a given tab and URL.
 * If the same tab and domain are already active, preserves the ongoing session.
 * Records a switch event if transitioning from a different tracked domain.
 *
 * @param {number} tabId - Browser tab ID.
 * @param {string} url - Tab URL.
 * @param {Date} [startDate=new Date()] - Start timestamp.
 * @returns {Promise<Object|null>} - Active session or null.
 */
async function startSession(tabId, url, startDate = new Date()) {
  await syncHourlyState(startDate);

  // 1. Detect and normalize domain
  const hostname = getDomainFromUrl(url);

  // If URL is inaccessible or internal (e.g. chrome://, edge://), end ongoing session and do not track
  if (!hostname) {
    console.log('[FocusGuard] Non-web or internal URL ignored:', url);
    await endSession(startDate);
    return null;
  }

  const domain = normalizeDomain(hostname);
  const active = await getActiveSession();

  // If already tracking the same domain on this tab, keep ongoing session uninterrupted
  if (active && (active.tabId === tabId || active.tab_id === tabId) && (active.domain === domain || active.name === domain)) {
    return active;
  }

  // Determine previous tracked domain before ending previous session
  let previousDomain = active ? (active.name || active.domain) : lastActiveDomain;
  if (!previousDomain && lastActiveDomain) {
    previousDomain = lastActiveDomain;
  }

  // Finalize previous session
  await endSession(startDate);

  // Record switch event if switching between two different valid domains
  if (previousDomain && domain && previousDomain !== domain) {
    await recordSwitchEvent(previousDomain, domain, startDate);
  } else {
    lastActiveDomain = domain;
    await chrome.storage.local.set({ lastActiveDomain: domain });
  }

  // 2. Initialize new session record
  const startTimeDate = new Date(startDate);
  const startTimeIso = startTimeDate.toISOString();
  const startTimeMs = startTimeDate.getTime();
  const cleanUrl = sanitizeUrl(url);
  const domainCategory = classifyDomain(domain);

  const newSession = {
    id: generateSessionId(),
    tabId: tabId,
    tab_id: tabId,
    domain: domain,
    name: domain,
    category: domainCategory,
    hostname: hostname,
    url: cleanUrl,
    startTime: startTimeIso,
    timestamp: startTimeIso,
    start_time: formatTimeHHMM(startTimeDate),
    lastActiveTime: startTimeMs,
    accumulatedActiveMs: 0,
    isPaused: false,
    idleState: 'active',
    lastPauseTime: null
  };

  await setActiveSession(newSession);

  console.log(`[FocusGuard] Domain detected: ${domain}`);
  console.log(`[FocusGuard] Session started: ${domain} (Tab: ${tabId}) at ${formatTimeHHMM(startTimeDate)} [${startTimeIso}]`);

  return newSession;
}

/**
 * Robustly queries the currently active tab in the user's primary browser window.
 *
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function getActiveBrowserTab() {
  try {
    // 1. Try finding active tab in the last focused normal browser window
    if (chrome.windows && chrome.windows.getLastFocused) {
      try {
        const lastWin = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
        if (lastWin && Array.isArray(lastWin.tabs)) {
          const activeTab = lastWin.tabs.find((t) => t.active);
          if (activeTab) return activeTab;
        }
      } catch (e) {
        // Fallback to tabs query
      }
    }

    // 2. Query active tabs in the last focused window
    const tabsInFocused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabsInFocused && tabsInFocused.length > 0 && tabsInFocused[0].url) {
      return tabsInFocused[0];
    }

    // 3. Fallback: Query all active tabs across windows
    const allActive = await chrome.tabs.query({ active: true });
    if (allActive && allActive.length > 0) {
      const webTab = allActive.find((t) => t.url && getDomainFromUrl(t.url));
      return webTab || allActive[0];
    }

    return null;
  } catch (error) {
    console.warn('[FocusGuard] Error querying active browser tab:', error);
    return null;
  }
}

/**
 * Reconciles active session state with the actual active browser tab.
 * Safely preserves ongoing session if active tab already matches.
 *
 * @returns {Promise<Object|null>}
 */
async function reconcileActiveTab() {
  try {
    const activeTab = await getActiveBrowserTab();
    if (!activeTab || !activeTab.url) {
      return await getActiveSession();
    }

    const hostname = getDomainFromUrl(activeTab.url);
    if (!hostname) {
      // Inaccessible internal page (e.g. chrome://extensions)
      const current = await getActiveSession();
      if (current) {
        await endSession();
      }
      return null;
    }

    const domain = normalizeDomain(hostname);
    const current = await getActiveSession();

    // If currently tracked session already matches active tab and domain, preserve it!
    if (current && (current.tabId === activeTab.id || current.tab_id === activeTab.id) && (current.domain === domain || current.name === domain)) {
      return current;
    }

    // Otherwise transition to new active session
    return await startSession(activeTab.id, activeTab.url);
  } catch (error) {
    console.warn('[FocusGuard] Error reconciling active tab:', error);
    return await getActiveSession();
  }
}

/* ==========================================================================
   7. Chrome Extension Event Listeners
   ========================================================================== */

/**
 * 1. Active Tab Switching
 * Triggered when user switches focus to a different tab in the current window.
 */
chrome.tabs.onActivated.addListener((activeInfo) => {
  withSessionLock(async () => {
    console.log('[FocusGuard] Tab activated:', activeInfo.tabId);
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (tab && tab.url) {
        await startSession(tab.id, tab.url);
      } else {
        await endSession();
      }
    } catch (error) {
      console.warn('[FocusGuard] Unable to fetch activated tab info:', error);
    }
  });
});

/**
 * 2. URL Navigation Within Tab
 * Triggered when a tab navigates to a new URL or completes page loading.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process if navigation URL is provided or page load completed
  if (!changeInfo.url && changeInfo.status !== 'complete') {
    return;
  }

  const currentUrl = changeInfo.url || tab.url;
  if (!currentUrl) {
    return;
  }

  withSessionLock(async () => {
    try {
      const activeTab = await getActiveBrowserTab();
      if (!activeTab || activeTab.id !== tabId) {
        return; // Ignore updates in background tabs
      }

      const newHostname = getDomainFromUrl(currentUrl);
      const newDomain = normalizeDomain(newHostname);
      const active = await getActiveSession();

      // If domain has not changed on this tab, do not restart or interrupt ongoing session
      if (active && (active.tabId === tabId || active.tab_id === tabId) && (active.domain === newDomain || active.name === newDomain)) {
        return;
      }

      if (newDomain) {
        console.log('[FocusGuard] In-tab navigation detected to new domain:', currentUrl);
        await startSession(tabId, currentUrl);
      } else {
        console.log('[FocusGuard] In-tab navigation to non-web URL:', currentUrl);
        await endSession();
      }
    } catch (error) {
      console.warn('[FocusGuard] Error handling tab update:', error);
    }
  });
});

/**
 * 3. Tab Closure
 * Triggered when a browser tab is closed.
 */
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  withSessionLock(async () => {
    const active = await getActiveSession();
    if (active && (active.tabId === tabId || active.tab_id === tabId)) {
      console.log('[FocusGuard] Tracked tab closed:', tabId);
      await endSession();
    }
  });
});

/**
 * 4. Browser Window Focus Change
 * Ignores WINDOW_ID_NONE to avoid interrupting active sessions when user opens popup.
 */
chrome.windows.onFocusChanged.addListener((windowId) => {
  // Ignore WINDOW_ID_NONE because opening the extension popup, clicking devtools,
  // or opening a context menu can temporarily shift window focus without ending the session.
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    console.log('[FocusGuard] Focus shifted from browser window (preserving active session state)');
    return;
  }

  withSessionLock(async () => {
    console.log('[FocusGuard] Browser window focused:', windowId);
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: windowId });
      if (activeTab && activeTab.url) {
        const hostname = getDomainFromUrl(activeTab.url);
        if (hostname) {
          const domain = normalizeDomain(hostname);
          const active = await getActiveSession();
          // If returning to the same active tab and domain, preserve session
          if (active && (active.tabId === activeTab.id || active.tab_id === activeTab.id) && (active.domain === domain || active.name === domain)) {
            return;
          }
          await startSession(activeTab.id, activeTab.url);
        } else {
          await endSession();
        }
      }
    } catch (error) {
      console.warn('[FocusGuard] Error on window focus change:', error);
    }
  });
});

/**
 * 5. Extension Message Channel
 * Allows popup to reconcile and fetch the active session upon opening.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'SYNC_AUTH_TOKEN') {
    chrome.storage.local.set({
      jwtAccessToken: message.token,
      jwtRefreshToken: message.refresh || ''
    }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message && message.type === 'SET_SESSION_STATUS') {
    chrome.storage.local.set({ focusSessionActive: Boolean(message.active) })
      .then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message && message.type === 'POPUP_OPENED') {
    withSessionLock(async () => {
      const active = await getActiveSession();
      if (active && !active.isPaused) {
        updateSessionActivity(active, Date.now());
        await setActiveSession(active);
      }
      return await reconcileActiveTab();
    }).then((session) => {
      sendResponse({ currentSession: session });
    }).catch((err) => {
      console.error('[FocusGuard] Error handling POPUP_OPENED message:', err);
      sendResponse({ currentSession: null });
    });
    return true; // Keep message channel open for asynchronous response
  }
});

/**
 * 6. Idle & Lock State Management
 * Detects user inactivity or OS screen lock / sleep.
 */
if (typeof chrome !== 'undefined' && chrome.idle && chrome.idle.onStateChanged) {
  try {
    if (typeof chrome.idle.setDetectionInterval === 'function') {
      chrome.idle.setDetectionInterval(60);
    }
  } catch (e) {}

  chrome.idle.onStateChanged.addListener((newState) => {
    withSessionLock(async () => {
      await handleIdleStateChange(newState);
    });
  });
}

// Lightweight active heartbeat timer while service worker is active
if (typeof setInterval !== 'undefined') {
  const heartbeatTimer = setInterval(async () => {
    try {
      const active = await getActiveSession();
      if (active && !active.isPaused) {
        updateSessionActivity(active, Date.now());
        await setActiveSession(active);
      }
    } catch (e) {}
  }, HEARTBEAT_INTERVAL_MS);
  if (heartbeatTimer && typeof heartbeatTimer.unref === 'function') {
    heartbeatTimer.unref();
  }
}

/**
 * 7. Lifecycle Initialization
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[FocusGuard] Extension installed/updated. Reason:', details.reason);
  const installData = await chrome.storage.local.get(['sessions', 'currentSession', 'switch_events', 'lastActiveDomain', 'current_hour', 'hourly_summaries']);
  const updates = {};
  if (!Array.isArray(installData.sessions)) {
    updates.sessions = [];
  }
  if (!Array.isArray(installData.switch_events)) {
    updates.switch_events = [];
  }
  if (!Array.isArray(installData.hourly_summaries)) {
    updates.hourly_summaries = [];
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
  await syncHourlyState();
  await loadClassificationCache();
  const stateData = await chrome.storage.local.get(['currentSession', 'lastActiveDomain', 'lastDistractionState', 'current_hour']);
  lastActiveDomain = stateData.lastActiveDomain || (stateData.currentSession ? (stateData.currentSession.name || stateData.currentSession.domain) : null);
  if (stateData.lastDistractionState) {
    lastDistractionState = stateData.lastDistractionState;
  } else if (stateData.current_hour && stateData.current_hour.classification) {
    lastDistractionState = stateData.current_hour.classification;
  }
  withSessionLock(async () => {
    await reconcileActiveTab();
  });
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[FocusGuard] Browser startup initiated');
  await syncHourlyState();
  await loadClassificationCache();
  const data = await chrome.storage.local.get(['currentSession', 'lastActiveDomain', 'lastDistractionState', 'current_hour']);
  lastActiveDomain = data.lastActiveDomain || (data.currentSession ? (data.currentSession.name || data.currentSession.domain) : null);
  if (data.lastDistractionState) {
    lastDistractionState = data.lastDistractionState;
  } else if (data.current_hour && data.current_hour.classification) {
    lastDistractionState = data.current_hour.classification;
  }
  withSessionLock(async () => {
    await reconcileActiveTab();
  });
});

// Immediate reconciliation when service worker boots or wakes from idle
withSessionLock(async () => {
  await syncHourlyState();
  await loadClassificationCache();
  const data = await chrome.storage.local.get(['currentSession', 'lastActiveDomain', 'lastDistractionState', 'current_hour']);
  lastActiveDomain = data.lastActiveDomain || (data.currentSession ? (data.currentSession.name || data.currentSession.domain) : null);
  if (data.lastDistractionState) {
    lastDistractionState = data.lastDistractionState;
  } else if (data.current_hour && data.current_hour.classification) {
    lastDistractionState = data.current_hour.classification;
  }
  await reconcileActiveTab();
});

// CommonJS exports for automated testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DOMAIN_CATEGORIES,
    MAX_CACHE_ENTRIES,
    CACHE_TTL_MS,
    CACHE_STORAGE_KEY,
    RESOLVER_ENDPOINT,
    RESOLVER_TIMEOUT_MS,
    pendingDomainResolutions,
    fetchDomainClassification,
    classifyDomain,
    classifyDomainAsync,
    getCachedDomainCategory,
    setCachedDomainCategory,
    loadClassificationCache,
    purgeExpiredCache,
    registerDomainResolver,
    resolveUnknownDomainAsync,
    getDomainFromUrl,
    normalizeDomain,
    sanitizeUrl,
    startSession,
    endSession,
    recordSwitchEvent,
    syncHourlyState,
    classifySwitchCount,
    getCurrentHourWindow,
    calculateDistractionState,
    checkDistractionTransition,
    NOTIFICATION_COOLDOWN_MS,
    NOTIFICATION_STORAGE_KEY,
    sendDistractionNotification,
    evaluateAndNotifyDistraction,
    SLEEP_GAP_THRESHOLD_MS,
    HEARTBEAT_INTERVAL_MS,
    updateSessionActivity,
    handleIdleStateChange,
    pauseActiveSession,
    resumeActiveSession,
    getActiveSession,
    setActiveSession
  };
}
