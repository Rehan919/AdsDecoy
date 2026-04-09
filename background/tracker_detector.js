importScripts("../utils/domain_matcher.js", "../persona/persona_data.js", "../persona/persona_engine.js");

const { extractHostname, findMatchingTrackerDomain, getBaseDomain, isThirdPartyRequest } = globalThis.DomainMatcher;
const { DEFAULT_PERSONA } = globalThis.PersonaData;
const { registerPersonaAlarmListener, syncPersonaEngine } = globalThis.PersonaEngine;

const PROTECTION_RESUME_ALARM = "digital-decoy:protection-resume";
const DEFAULT_STATE = {
  blockedTrackers: [],
  tabProtectionState: {},
  trustedSites: [],
  pausedSites: [],
  protectionPauseUntil: null,
  lastCleanupSummary: null,
  deceptionEnabled: false,
  selectedPersona: DEFAULT_PERSONA,
  nextPersonaRunAt: null,
  lastPersonaRunAt: null,
  lastPersonaName: DEFAULT_PERSONA,
  lastPersonaSessionSize: 0,
  personaSessionActive: false,
  personaSessionQueue: [],
  personaActiveTabId: null,
  personaSessionHistory: []
};

const STORAGE_KEYS = Object.keys(DEFAULT_STATE);
const TRACKER_CATALOG_URL = chrome.runtime.getURL("data/tracker_catalog.json");
const TRACKER_WRITE_DEBOUNCE_MS = 1200;
const MAX_BLOCKED_ENTRIES = 250;
const MAX_BLOCKED_ENTRY_AGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_ID_TTL_MS = 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const BLOCKABLE_RESOURCE_TYPES = [
  "script",
  "image",
  "xmlhttprequest",
  "sub_frame",
  "ping",
  "other"
];
const SITE_DATA_REMOVAL_TYPES = {
  cookies: true,
  cacheStorage: true,
  fileSystems: true,
  indexedDB: true,
  localStorage: true,
  serviceWorkers: true,
  webSQL: true
};
const INVALID_PROTOCOLS = [
  "chrome:",
  "chrome-extension:",
  "edge:",
  "brave:",
  "about:",
  "devtools:",
  "file:"
];
const NON_BLOCKING_TRACKER_DOMAINS = new Set([
  "amazon.com",
  "ampproject.org",
  "bing.com",
  "cloudfront.net",
  "facebook.com",
  "gstatic.com",
  "instagram.com",
  "licdn.com",
  "pinimg.com",
  "reddit.com",
  "sc-static.net",
  "tiktok.com",
  "yahoo.com"
]);

let trackerCatalog = {};
let trackerDomains = new Set();
let blockableTrackerDomains = new Set();
let trackerWriteTimer = null;
let pendingBlockedEvents = [];
const recentlyRecordedRequestIds = new Map();
const controlStateCache = {
  trustedSites: new Set(),
  pausedSites: new Set(),
  protectionPauseUntil: null
};

function isTrackableRequest(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function hasInvalidProtocol(url) {
  return INVALID_PROTOCOLS.some((protocol) => typeof url === "string" && url.startsWith(protocol));
}

function isBlockableResourceType(resourceType) {
  return BLOCKABLE_RESOURCE_TYPES.includes(resourceType || "");
}

function isProtectionPaused() {
  return Boolean(controlStateCache.protectionPauseUntil && controlStateCache.protectionPauseUntil > Date.now());
}

function getSiteControlKey(hostname) {
  return getBaseDomain(hostname) || hostname || "";
}

function getOriginsForDomain(hostname) {
  if (!hostname) {
    return [];
  }

  const normalizedHostname = hostname.replace(/^\./, "");
  return [`https://${normalizedHostname}`, `http://${normalizedHostname}`];
}

function dedupeArray(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function cleanupRecordedRequestIds() {
  const cutoff = Date.now() - REQUEST_ID_TTL_MS;

  for (const [requestId, timestamp] of recentlyRecordedRequestIds.entries()) {
    if (timestamp < cutoff) {
      recentlyRecordedRequestIds.delete(requestId);
    }
  }
}

function markRequestAsRecorded(requestId) {
  if (!requestId) {
    return true;
  }

  cleanupRecordedRequestIds();

  if (recentlyRecordedRequestIds.has(requestId)) {
    return false;
  }

  recentlyRecordedRequestIds.set(requestId, Date.now());
  return true;
}

function trimBlockedTrackers(blockedTrackers) {
  const cutoff = Date.now() - MAX_BLOCKED_ENTRY_AGE_MS;
  return (blockedTrackers || [])
    .filter((entry) => Number(entry.lastSeen) > cutoff)
    .slice(0, MAX_BLOCKED_ENTRIES);
}

function buildBlockingRules() {
  if (isProtectionPaused()) {
    return [];
  }

  const excludedInitiatorDomains = dedupeArray([
    ...controlStateCache.trustedSites,
    ...controlStateCache.pausedSites
  ]);

  return [...blockableTrackerDomains]
    .sort()
    .map((domain, index) => ({
      id: index + 1,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: `||${domain}/`,
        domainType: "thirdParty",
        resourceTypes: BLOCKABLE_RESOURCE_TYPES,
        ...(excludedInitiatorDomains.length > 0 ? { excludedInitiatorDomains } : {})
      }
    }));
}

async function ensureDefaultState() {
  const existingState = await chrome.storage.local.get(STORAGE_KEYS);
  const nextState = {};

  for (const [key, value] of Object.entries(DEFAULT_STATE)) {
    if (existingState[key] === undefined) {
      nextState[key] = value;
    }
  }

  if (Object.keys(nextState).length > 0) {
    await chrome.storage.local.set(nextState);
  }
}

async function loadTrackerCatalog() {
  const response = await fetch(TRACKER_CATALOG_URL);
  trackerCatalog = await response.json();
  trackerDomains = new Set(Object.keys(trackerCatalog));
  blockableTrackerDomains = new Set(
    [...trackerDomains].filter((domain) => !NON_BLOCKING_TRACKER_DOMAINS.has(domain))
  );
}

async function refreshControlStateCache() {
  const state = await chrome.storage.local.get([
    "trustedSites",
    "pausedSites",
    "protectionPauseUntil"
  ]);

  const trustedSites = Array.isArray(state.trustedSites) ? state.trustedSites : [];
  const pausedSites = Array.isArray(state.pausedSites) ? state.pausedSites : [];
  const protectionPauseUntil =
    typeof state.protectionPauseUntil === "number" && state.protectionPauseUntil > Date.now()
      ? state.protectionPauseUntil
      : null;

  controlStateCache.trustedSites = new Set(trustedSites);
  controlStateCache.pausedSites = new Set(pausedSites);
  controlStateCache.protectionPauseUntil = protectionPauseUntil;

  if (state.protectionPauseUntil && !protectionPauseUntil) {
    await chrome.storage.local.set({ protectionPauseUntil: null });
  }
}

async function syncProtectionPauseAlarm() {
  await chrome.alarms.clear(PROTECTION_RESUME_ALARM);

  if (isProtectionPaused()) {
    chrome.alarms.create(PROTECTION_RESUME_ALARM, {
      when: controlStateCache.protectionPauseUntil
    });
  }
}

async function syncBlockingRules() {
  if (trackerDomains.size === 0) {
    await loadTrackerCatalog();
  }

  await refreshControlStateCache();
  await syncProtectionPauseAlarm();

  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const rulesToRemove = existingRules.map((rule) => rule.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: rulesToRemove,
    addRules: buildBlockingRules()
  });
}

function isValidBlockingCandidate(details) {
  if (!details || !isTrackableRequest(details.url)) {
    return false;
  }

  if (typeof details.tabId === "number" && details.tabId < 0) {
    return false;
  }

  if (hasInvalidProtocol(details.url) || hasInvalidProtocol(details.initiator) || hasInvalidProtocol(details.documentUrl)) {
    return false;
  }

  return extractHostname(details.url) !== "" && isBlockableResourceType(details.type);
}

function getSourcePageDomainFallback(details) {
  const candidates = [
    details.documentUrl,
    details.initiator,
    details.originUrl
  ];

  for (const candidate of candidates) {
    const hostname = extractHostname(candidate || "");

    if (hostname) {
      return hostname;
    }
  }

  return "unknown";
}

async function resolvePageDomain(details) {
  if (typeof details.tabId === "number" && details.tabId >= 0) {
    try {
      const tab = await chrome.tabs.get(details.tabId);
      const tabHostname = extractHostname(tab?.url || "");

      if (tabHostname) {
        return tabHostname;
      }
    } catch {
      // The tab may already be gone, which is safe to ignore.
    }
  }

  return getSourcePageDomainFallback(details);
}

function isProtectionDisabledForPage(pageDomain) {
  const siteKey = getSiteControlKey(pageDomain);

  if (!siteKey) {
    return isProtectionPaused();
  }

  return (
    isProtectionPaused() ||
    controlStateCache.trustedSites.has(siteKey) ||
    controlStateCache.pausedSites.has(siteKey)
  );
}

function getTrackerMetadata(domain) {
  return trackerCatalog[domain] || {
    company: domain,
    ownerName: domain,
    primaryCategory: "Unknown",
    categories: [],
    prevalence: 0,
    fingerprinting: 0,
    cookies: 0,
    sites: 0,
    riskScore: 0
  };
}

function mergeCategoryLists(left, right) {
  return dedupeArray([...(left || []), ...(right || [])]);
}

function scheduleTrackerFlush() {
  if (trackerWriteTimer !== null) {
    return;
  }

  trackerWriteTimer = setTimeout(async () => {
    trackerWriteTimer = null;
    await flushPendingTrackers();
  }, TRACKER_WRITE_DEBOUNCE_MS);
}

async function updateBadgeForTab(tabId, tabState) {
  if (typeof tabId !== "number" || tabId < 0) {
    return;
  }

  try {
    const blockedCount = Number(tabState?.blockedRequestCount) || 0;
    const badgeText = blockedCount <= 0 ? "" : blockedCount > 99 ? "99+" : String(blockedCount);

    await chrome.action.setBadgeText({ tabId, text: badgeText });
    await chrome.action.setTitle({
      tabId,
      title: blockedCount > 0
        ? `Digital Decoy blocked ${blockedCount} tracker request${blockedCount === 1 ? "" : "s"} on this tab.`
        : "Digital Decoy"
    });
  } catch {
    // The tab may have disappeared before the badge update completed.
  }
}

async function updateAllBadges(tabProtectionState) {
  const entries = Object.entries(tabProtectionState || {});

  await Promise.all(
    entries.map(([tabId, tabState]) => updateBadgeForTab(Number(tabId), tabState))
  );
}

async function flushPendingTrackers() {
  if (pendingBlockedEvents.length === 0) {
    return;
  }

  const eventsToWrite = pendingBlockedEvents;
  pendingBlockedEvents = [];

  const {
    blockedTrackers = [],
    tabProtectionState = {}
  } = await chrome.storage.local.get([
    "blockedTrackers",
    "tabProtectionState"
  ]);

  const nextTrackers = [...trimBlockedTrackers(blockedTrackers)];
  const nextTabState = { ...tabProtectionState };
  const touchedTabIds = new Set();

  for (const event of eventsToWrite) {
    const existingIndex = nextTrackers.findIndex((tracker) => {
      return tracker.domain === event.domain && tracker.pageDomain === event.pageDomain;
    });

    if (existingIndex >= 0) {
      const current = nextTrackers[existingIndex];
      nextTrackers[existingIndex] = {
        ...current,
        requestCount: current.requestCount + event.requestCount,
        lastSeen: event.lastSeen,
        company: event.company,
        ownerName: event.ownerName,
        primaryCategory: event.primaryCategory,
        categories: mergeCategoryLists(current.categories, event.categories),
        prevalence: Math.max(current.prevalence || 0, event.prevalence || 0),
        fingerprinting: Math.max(current.fingerprinting || 0, event.fingerprinting || 0),
        cookies: Math.max(current.cookies || 0, event.cookies || 0),
        sites: Math.max(current.sites || 0, event.sites || 0),
        riskScore: Math.max(current.riskScore || 0, event.riskScore || 0)
      };
    } else {
      nextTrackers.unshift(event);
    }

    if (typeof event.tabId === "number" && event.tabId >= 0) {
      const tabKey = String(event.tabId);
      const currentTabState = nextTabState[tabKey];
      const shouldResetTabState = currentTabState && currentTabState.pageDomain !== event.pageDomain;
      const companyCounts = shouldResetTabState ? {} : { ...(currentTabState?.companyCounts || {}) };

      companyCounts[event.company] = (companyCounts[event.company] || 0) + event.requestCount;
      nextTabState[tabKey] = {
        pageDomain: event.pageDomain,
        blockedRequestCount: (shouldResetTabState ? 0 : currentTabState?.blockedRequestCount || 0) + event.requestCount,
        blockedCompanyCount: Object.keys(companyCounts).length,
        companyCounts,
        lastSeen: event.lastSeen
      };
      touchedTabIds.add(event.tabId);
    }
  }

  const trimmedTrackers = trimBlockedTrackers(nextTrackers);

  await chrome.storage.local.set({
    blockedTrackers: trimmedTrackers,
    tabProtectionState: nextTabState
  });

  await Promise.all(
    [...touchedTabIds].map((tabId) => updateBadgeForTab(tabId, nextTabState[String(tabId)]))
  );
}

async function resetTabProtectionState(tabId, pageDomain) {
  if (typeof tabId !== "number" || tabId < 0) {
    return;
  }

  await flushPendingTrackers();
  const { tabProtectionState = {} } = await chrome.storage.local.get("tabProtectionState");

  tabProtectionState[String(tabId)] = {
    pageDomain: pageDomain || "",
    blockedRequestCount: 0,
    blockedCompanyCount: 0,
    companyCounts: {},
    lastSeen: Date.now()
  };

  await chrome.storage.local.set({ tabProtectionState });
  await updateBadgeForTab(tabId, tabProtectionState[String(tabId)]);
}

async function removeTabProtectionState(tabId) {
  if (typeof tabId !== "number" || tabId < 0) {
    return;
  }

  await flushPendingTrackers();
  const { tabProtectionState = {} } = await chrome.storage.local.get("tabProtectionState");

  if (tabProtectionState[String(tabId)]) {
    delete tabProtectionState[String(tabId)];
    await chrome.storage.local.set({ tabProtectionState });
  }

  await updateBadgeForTab(tabId, null);
}

async function cleanupStaleTabProtectionState() {
  const openTabs = await chrome.tabs.query({});
  const openTabIds = new Set(openTabs.map((tab) => String(tab.id)));
  const { tabProtectionState = {} } = await chrome.storage.local.get("tabProtectionState");
  const nextTabState = {};

  for (const [tabId, tabState] of Object.entries(tabProtectionState)) {
    if (openTabIds.has(tabId)) {
      nextTabState[tabId] = tabState;
    }
  }

  await chrome.storage.local.set({ tabProtectionState: nextTabState });
  await chrome.action.setBadgeBackgroundColor({ color: "#8b3a2f" });
  await updateAllBadges(nextTabState);
}

async function clearBlockedHistoryForSite(pageDomain, tabId) {
  const { blockedTrackers = [] } = await chrome.storage.local.get("blockedTrackers");
  const nextTrackers = blockedTrackers.filter((tracker) => tracker.pageDomain !== pageDomain);
  const updates = {
    blockedTrackers: nextTrackers
  };

  if (typeof tabId === "number" && tabId >= 0) {
    const { tabProtectionState = {} } = await chrome.storage.local.get("tabProtectionState");
    tabProtectionState[String(tabId)] = {
      pageDomain,
      blockedRequestCount: 0,
      blockedCompanyCount: 0,
      companyCounts: {},
      lastSeen: Date.now()
    };
    updates.tabProtectionState = tabProtectionState;
    await updateBadgeForTab(tabId, tabProtectionState[String(tabId)]);
  }

  await chrome.storage.local.set(updates);
}

async function reloadTabForProtectionChange(tabId, siteDomain) {
  if (typeof tabId !== "number" || tabId < 0) {
    return;
  }

  await resetTabProtectionState(tabId, siteDomain);

  try {
    await chrome.tabs.reload(tabId);
  } catch {
    // The tab may have closed before the reload was requested.
  }
}

async function upsertSiteControl(action, siteDomain, tabId) {
  const siteKey = getSiteControlKey(siteDomain);

  if (!siteKey) {
    return { ok: false, message: "No website is active right now." };
  }

  const state = await chrome.storage.local.get([
    "trustedSites",
    "pausedSites"
  ]);
  const trustedSites = new Set(Array.isArray(state.trustedSites) ? state.trustedSites : []);
  const pausedSites = new Set(Array.isArray(state.pausedSites) ? state.pausedSites : []);

  if (action === "trust") {
    trustedSites.add(siteKey);
    pausedSites.delete(siteKey);
  }

  if (action === "untrust") {
    trustedSites.delete(siteKey);
  }

  if (action === "pause") {
    pausedSites.add(siteKey);
    trustedSites.delete(siteKey);
  }

  if (action === "resume") {
    pausedSites.delete(siteKey);
  }

  await chrome.storage.local.set({
    trustedSites: [...trustedSites].sort(),
    pausedSites: [...pausedSites].sort()
  });

  await refreshControlStateCache();
  await syncBlockingRules();
  await clearBlockedHistoryForSite(siteDomain, tabId);
  await reloadTabForProtectionChange(tabId, siteDomain);

  return {
    ok: true,
    siteKey,
    trusted: trustedSites.has(siteKey),
    paused: pausedSites.has(siteKey)
  };
}

async function pauseProtectionForThirtyMinutes(tabId, siteDomain) {
  const protectionPauseUntil = Date.now() + THIRTY_MINUTES_MS;

  await chrome.storage.local.set({ protectionPauseUntil });
  await refreshControlStateCache();
  await syncBlockingRules();
  await reloadTabForProtectionChange(tabId, siteDomain);

  return {
    ok: true,
    protectionPauseUntil
  };
}

async function resumeProtection(tabId, siteDomain) {
  await chrome.storage.local.set({ protectionPauseUntil: null });
  await refreshControlStateCache();
  await syncBlockingRules();
  await reloadTabForProtectionChange(tabId, siteDomain);

  return {
    ok: true,
    protectionPauseUntil: null
  };
}

async function recordBlockedTracker(details) {
  if (trackerDomains.size === 0) {
    await loadTrackerCatalog();
  }

  if (!isValidBlockingCandidate(details)) {
    return;
  }

  const hostname = extractHostname(details.url);
  const matchedDomain = findMatchingTrackerDomain(hostname, blockableTrackerDomains);

  if (!matchedDomain) {
    return;
  }

  if (!markRequestAsRecorded(details.requestId)) {
    return;
  }

  const pageDomain = await resolvePageDomain(details);

  if (!isThirdPartyRequest(hostname, pageDomain)) {
    return;
  }

  if (isProtectionDisabledForPage(pageDomain)) {
    return;
  }

  const metadata = getTrackerMetadata(matchedDomain);

  pendingBlockedEvents.push({
    tabId: details.tabId,
    domain: matchedDomain,
    company: metadata.company,
    ownerName: metadata.ownerName,
    pageDomain: pageDomain || "unknown",
    requestCount: 1,
    lastSeen: Date.now(),
    primaryCategory: metadata.primaryCategory,
    categories: metadata.categories || [],
    prevalence: metadata.prevalence || 0,
    fingerprinting: metadata.fingerprinting || 0,
    cookies: metadata.cookies || 0,
    sites: metadata.sites || 0,
    riskScore: metadata.riskScore || 0
  });

  scheduleTrackerFlush();
}

async function clearCurrentSiteData(siteDomain) {
  if (!siteDomain) {
    return { ok: false, message: "No active website is available for cleanup." };
  }

  await chrome.browsingData.remove(
    { origins: getOriginsForDomain(siteDomain) },
    SITE_DATA_REMOVAL_TYPES
  );

  const summary = {
    siteDomain,
    message: `Cleared stored site data for ${siteDomain}.`,
    timestamp: Date.now()
  };

  await chrome.storage.local.set({ lastCleanupSummary: summary });
  return { ok: true, summary };
}

async function clearTrackerCookiesForSite(siteDomain) {
  if (!siteDomain) {
    return { ok: false, message: "No active website is available for tracker cleanup." };
  }

  await flushPendingTrackers();
  const { blockedTrackers = [] } = await chrome.storage.local.get("blockedTrackers");
  const trackerDomainsForSite = dedupeArray(
    blockedTrackers
      .filter((tracker) => tracker.pageDomain === siteDomain)
      .map((tracker) => tracker.domain)
  );

  if (trackerDomainsForSite.length === 0) {
    const summary = {
      siteDomain,
      message: `No known tracker cookies were recorded for ${siteDomain} yet.`,
      timestamp: Date.now()
    };
    await chrome.storage.local.set({ lastCleanupSummary: summary });
    return { ok: true, summary };
  }

  await chrome.browsingData.remove(
    { origins: trackerDomainsForSite.flatMap((domain) => getOriginsForDomain(domain)) },
    { cookies: true }
  );

  const summary = {
    siteDomain,
    trackerDomainCount: trackerDomainsForSite.length,
    message: `Cleared cookies for ${trackerDomainsForSite.length} blocked tracker domain${trackerDomainsForSite.length === 1 ? "" : "s"}.`,
    timestamp: Date.now()
  };

  await chrome.storage.local.set({ lastCleanupSummary: summary });
  return { ok: true, summary };
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaultState();
  await loadTrackerCatalog();
  await refreshControlStateCache();
  await cleanupStaleTabProtectionState();
  await syncBlockingRules();
  await syncPersonaEngine(true);
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaultState();
  await loadTrackerCatalog();
  await refreshControlStateCache();
  await cleanupStaleTabProtectionState();
  await syncBlockingRules();
  await syncPersonaEngine();
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    recordBlockedTracker(details).catch(() => {});
  },
  { urls: ["<all_urls>"], types: BLOCKABLE_RESOURCE_TYPES }
);

if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((matchInfo) => {
    recordBlockedTracker(matchInfo.request).catch(() => {});
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const nextHostname = extractHostname(changeInfo.url || tab.url || "");

  if (changeInfo.url || changeInfo.status === "loading") {
    resetTabProtectionState(tabId, nextHostname).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabProtectionState(tabId).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PROTECTION_RESUME_ALARM) {
    resumeProtection().catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.deceptionEnabled || changes.selectedPersona) {
    syncPersonaEngine(Boolean(changes.selectedPersona)).catch(() => {});
  }

  if (changes.trustedSites || changes.pausedSites || changes.protectionPauseUntil) {
    refreshControlStateCache()
      .then(() => syncBlockingRules())
      .catch(() => {});
  }
});

registerPersonaAlarmListener();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "digital-decoy:get-state") {
    flushPendingTrackers()
      .catch(() => {})
      .finally(() => {
        chrome.storage.local
          .get(STORAGE_KEYS)
          .then((state) => {
            sendResponse({
              blockedTrackers: state.blockedTrackers ?? DEFAULT_STATE.blockedTrackers,
              tabProtectionState: state.tabProtectionState ?? DEFAULT_STATE.tabProtectionState,
              trustedSites: state.trustedSites ?? DEFAULT_STATE.trustedSites,
              pausedSites: state.pausedSites ?? DEFAULT_STATE.pausedSites,
              protectionPauseUntil: state.protectionPauseUntil ?? DEFAULT_STATE.protectionPauseUntil,
              lastCleanupSummary: state.lastCleanupSummary ?? DEFAULT_STATE.lastCleanupSummary,
              deceptionEnabled: state.deceptionEnabled ?? DEFAULT_STATE.deceptionEnabled,
              selectedPersona: state.selectedPersona ?? DEFAULT_STATE.selectedPersona,
              nextPersonaRunAt: state.nextPersonaRunAt ?? DEFAULT_STATE.nextPersonaRunAt,
              lastPersonaRunAt: state.lastPersonaRunAt ?? DEFAULT_STATE.lastPersonaRunAt,
              lastPersonaName: state.lastPersonaName ?? DEFAULT_STATE.lastPersonaName,
              lastPersonaSessionSize: state.lastPersonaSessionSize ?? DEFAULT_STATE.lastPersonaSessionSize,
              personaSessionActive: state.personaSessionActive ?? DEFAULT_STATE.personaSessionActive,
              protectionMode: isProtectionPaused() ? "paused" : "blocking"
            });
          })
          .catch(() => {
            sendResponse(DEFAULT_STATE);
          });
      });

    return true;
  }

  if (message?.type === "digital-decoy:trust-site") {
    upsertSiteControl("trust", message.siteDomain, message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "Failed to trust this site." }));
    return true;
  }

  if (message?.type === "digital-decoy:untrust-site") {
    upsertSiteControl("untrust", message.siteDomain, message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "Failed to remove site trust." }));
    return true;
  }

  if (message?.type === "digital-decoy:pause-site") {
    upsertSiteControl("pause", message.siteDomain, message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "Failed to pause this site." }));
    return true;
  }

  if (message?.type === "digital-decoy:resume-site") {
    upsertSiteControl("resume", message.siteDomain, message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "Failed to resume blocking for this site." }));
    return true;
  }

  if (message?.type === "digital-decoy:pause-protection") {
    pauseProtectionForThirtyMinutes(message.tabId, message.siteDomain)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "Failed to pause protection." }));
    return true;
  }

  if (message?.type === "digital-decoy:resume-protection") {
    resumeProtection(message.tabId, message.siteDomain)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "Failed to resume protection." }));
    return true;
  }

  if (message?.type === "digital-decoy:clear-site-data") {
    clearCurrentSiteData(message.siteDomain)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "Failed to clear site data." }));
    return true;
  }

  if (message?.type === "digital-decoy:clear-tracker-cookies") {
    clearTrackerCookiesForSite(message.siteDomain)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error?.message || "Failed to clear tracker cookies." }));
    return true;
  }

  return false;
});
