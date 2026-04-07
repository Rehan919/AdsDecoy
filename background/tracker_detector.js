importScripts("../utils/domain_matcher.js", "../persona/persona_data.js", "../persona/persona_engine.js");

const { extractHostname, findMatchingTrackerDomain } = globalThis.DomainMatcher;
const { DEFAULT_PERSONA } = globalThis.PersonaData;
const { registerPersonaAlarmListener, syncPersonaEngine } = globalThis.PersonaEngine;

const DEFAULT_STATE = {
  detectedTrackers: [],
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
const TRACKER_MAP_URL = chrome.runtime.getURL("data/tracker_map.json");
const TRACKER_WRITE_DEBOUNCE_MS = 1500;
const MAX_TRACKER_ENTRIES = 100;
const INVALID_PROTOCOLS = [
  "chrome:",
  "chrome-extension:",
  "edge:",
  "brave:",
  "about:",
  "devtools:",
  "file:"
];

let trackerMap = {};
let trackerDomains = new Set();
let trackerWriteTimer = null;
let pendingTrackerEvents = [];

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

async function loadTrackerMap() {
  const response = await fetch(TRACKER_MAP_URL);
  trackerMap = await response.json();
  trackerDomains = new Set(Object.keys(trackerMap));
}

function isTrackableRequest(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function hasInvalidProtocol(url) {
  return INVALID_PROTOCOLS.some((protocol) => typeof url === "string" && url.startsWith(protocol));
}

function isValidTrackerRequest(details) {
  if (!details || !isTrackableRequest(details.url)) {
    return false;
  }

  if (typeof details.tabId === "number" && details.tabId < 0) {
    return false;
  }

  if (hasInvalidProtocol(details.url) || hasInvalidProtocol(details.initiator) || hasInvalidProtocol(details.documentUrl)) {
    return false;
  }

  return extractHostname(details.url) !== "";
}

function getSourcePageDomain(details) {
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

async function flushPendingTrackers() {
  if (pendingTrackerEvents.length === 0) {
    return;
  }

  const eventsToWrite = pendingTrackerEvents;
  pendingTrackerEvents = [];

  const { detectedTrackers = [] } = await chrome.storage.local.get("detectedTrackers");
  const nextTrackers = [...detectedTrackers];

  for (const event of eventsToWrite) {
    const existingIndex = nextTrackers.findIndex((tracker) => {
      return tracker.domain === event.domain && tracker.tabId === event.tabId && tracker.pageDomain === event.pageDomain;
    });

    if (existingIndex >= 0) {
      const current = nextTrackers[existingIndex];
      nextTrackers[existingIndex] = {
        ...current,
        requestCount: current.requestCount + event.requestCount,
        lastSeen: event.lastSeen,
        company: event.company,
        pageDomain: event.pageDomain
      };
    } else {
      nextTrackers.unshift(event);
    }
  }

  await chrome.storage.local.set({ detectedTrackers: nextTrackers.slice(0, MAX_TRACKER_ENTRIES) });
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

async function recordDetectedTracker(details) {
  if (trackerDomains.size === 0) {
    await loadTrackerMap();
  }

  if (!isValidTrackerRequest(details)) {
    return;
  }

  const hostname = extractHostname(details.url);
  const matchedDomain = findMatchingTrackerDomain(hostname, trackerDomains);

  if (!matchedDomain) {
    return;
  }

  pendingTrackerEvents.push({
    tabId: details.tabId,
    domain: matchedDomain,
    company: trackerMap[matchedDomain] || "Unknown",
    pageDomain: getSourcePageDomain(details) || "unknown",
    requestCount: 1,
    lastSeen: Date.now()
  });

  scheduleTrackerFlush();
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaultState();
  await loadTrackerMap();
  await syncPersonaEngine(true);
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaultState();
  await loadTrackerMap();
  await syncPersonaEngine();
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    recordDetectedTracker(details).catch(() => {});
  },
  { urls: ["<all_urls>"] }
);

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await flushPendingTrackers();
  const { detectedTrackers = [] } = await chrome.storage.local.get("detectedTrackers");
  const nextTrackers = detectedTrackers.filter((tracker) => tracker.tabId !== tabId);

  if (nextTrackers.length !== detectedTrackers.length) {
    await chrome.storage.local.set({ detectedTrackers: nextTrackers });
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.deceptionEnabled || changes.selectedPersona) {
    syncPersonaEngine(Boolean(changes.selectedPersona)).catch(() => {});
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
              detectedTrackers: state.detectedTrackers ?? DEFAULT_STATE.detectedTrackers,
              deceptionEnabled: state.deceptionEnabled ?? DEFAULT_STATE.deceptionEnabled,
              selectedPersona: state.selectedPersona ?? DEFAULT_STATE.selectedPersona,
              nextPersonaRunAt: state.nextPersonaRunAt ?? DEFAULT_STATE.nextPersonaRunAt,
              lastPersonaRunAt: state.lastPersonaRunAt ?? DEFAULT_STATE.lastPersonaRunAt,
              lastPersonaName: state.lastPersonaName ?? DEFAULT_STATE.lastPersonaName,
              lastPersonaSessionSize: state.lastPersonaSessionSize ?? DEFAULT_STATE.lastPersonaSessionSize,
              personaSessionActive: state.personaSessionActive ?? DEFAULT_STATE.personaSessionActive
            });
          })
          .catch(() => {
            sendResponse(DEFAULT_STATE);
          });
        });

    return true;
  }

  return false;
});
