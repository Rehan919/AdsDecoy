const COMMON_SECOND_LEVEL_SUFFIXES = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "net",
  "org"
]);
const HIGH_RISK_CATEGORIES = new Set([
  "Action Pixels",
  "Malware",
  "Session Replay",
  "Unknown High Risk Behavior"
]);

const siteDomainElement = document.getElementById("site-domain");
const siteStatusElement = document.getElementById("site-status");
const siteControlDetailElement = document.getElementById("site-control-detail");
const scoreCaptionElement = document.getElementById("score-caption");
const scoreSignalsElement = document.getElementById("score-signals");
const privacyScoreValueElement = document.getElementById("privacy-score-value");
const privacyScoreBadgeElement = document.getElementById("privacy-score-badge");
const extensionStatusElement = document.getElementById("extension-status");
const toggleExtensionButton = document.getElementById("toggle-extension");
const masterSwitchDetailElement = document.getElementById("master-switch-detail");
const protectionModeBadgeElement = document.getElementById("protection-mode-badge");
const blockedRequestCountElement = document.getElementById("blocked-request-count");
const blockedCompanyCountElement = document.getElementById("blocked-company-count");
const overallBlockedCountElement = document.getElementById("overall-blocked-count");
const protectedSiteCountElement = document.getElementById("protected-site-count");
const trackerListElement = document.getElementById("blocked-company-list");
const cleanupStatusElement = document.getElementById("cleanup-status");
const pauseSiteButton = document.getElementById("pause-site");
const trustSiteButton = document.getElementById("trust-site");
const pauseProtectionButton = document.getElementById("pause-protection");
const clearSiteDataButton = document.getElementById("clear-site-data");
const clearTrackerCookiesButton = document.getElementById("clear-tracker-cookies");
const deceptionStatusElement = document.getElementById("deception-status");
const personaNameElement = document.getElementById("persona-name");
const sessionStatusElement = document.getElementById("session-status");
const scheduleTextElement = document.getElementById("schedule-text");
const personaSelectElement = document.getElementById("persona-select");
const customKeywordsContainer = document.getElementById("custom-keywords-container");
const customKeywordsInput = document.getElementById("custom-keywords-input");
const toggleButton = document.getElementById("toggle-deception");
const openDashboardButton = document.getElementById("open-dashboard");

let currentState = null;
let currentTabContext = {
  tabId: null,
  siteDomain: "",
  origin: ""
};

function extractHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function getBaseDomain(hostname) {
  if (!hostname) {
    return "";
  }

  const segments = hostname.split(".").filter(Boolean);

  if (segments.length <= 2) {
    return segments.join(".");
  }

  const lastSegment = segments[segments.length - 1];
  const secondLastSegment = segments[segments.length - 2];
  const hasCountryCodeSuffix =
    lastSegment.length === 2 &&
    COMMON_SECOND_LEVEL_SUFFIXES.has(secondLastSegment) &&
    segments.length >= 3;

  return hasCountryCodeSuffix
    ? segments.slice(-3).join(".")
    : segments.slice(-2).join(".");
}

function getSiteControlKey(hostname) {
  return getBaseDomain(hostname) || hostname || "";
}

function formatPersonaName(personaName) {
  if (!personaName) {
    return "Gardener";
  }

  return personaName.charAt(0).toUpperCase() + personaName.slice(1);
}

function formatScheduleText(state) {
  if (state.extensionEnabled === false) {
    return "Digital Decoy is switched off. Turn it on to use deception mode.";
  }

  if (!state.deceptionEnabled) {
    return "Enable deception mode to schedule persona browsing.";
  }

  if (state.personaSessionActive) {
    return `Running ${formatPersonaName(state.lastPersonaName || state.selectedPersona)} session now.`;
  }

  if (state.nextPersonaRunAt) {
    const nextRun = new Date(state.nextPersonaRunAt);
    return `Next run around ${nextRun.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  }

  if (state.lastPersonaRunAt) {
    return "Previous session finished. Next run will be scheduled shortly.";
  }

  return "Waiting for the next persona session window.";
}

function createEmptyState(message) {
  const item = document.createElement("li");
  item.className = "tracker-list__empty";
  item.textContent = message;
  return item;
}

function getActiveSiteEntries(blockedTrackers, siteDomain) {
  if (!Array.isArray(blockedTrackers) || blockedTrackers.length === 0 || !siteDomain) {
    return [];
  }

  const siteKey = getSiteControlKey(siteDomain);

  return blockedTrackers.filter((tracker) => getSiteControlKey(tracker.pageDomain) === siteKey);
}

function buildCompanySummary(siteEntries) {
  const companyMap = new Map();

  for (const entry of siteEntries) {
    const company = entry.company || "Unknown company";
    const current = companyMap.get(company) || {
      company,
      requestCount: 0,
      categories: new Set(),
      highestRisk: 0,
      domainCount: 0
    };

    current.requestCount += entry.requestCount || 0;
    current.highestRisk = Math.max(current.highestRisk, entry.riskScore || 0);
    current.domainCount += 1;

    for (const category of entry.categories || []) {
      current.categories.add(category);
    }

    companyMap.set(company, current);
  }

  return [...companyMap.values()].sort((left, right) => {
    if (right.requestCount !== left.requestCount) {
      return right.requestCount - left.requestCount;
    }

    return right.highestRisk - left.highestRisk;
  });
}

function buildOverallSummary(blockedTrackers) {
  if (!Array.isArray(blockedTrackers) || blockedTrackers.length === 0) {
    return {
      blockedRequestCount: 0,
      protectedSiteCount: 0
    };
  }

  const protectedSites = new Set();
  let blockedRequestCount = 0;

  for (const tracker of blockedTrackers) {
    blockedRequestCount += tracker.requestCount || 0;

    if (tracker.pageDomain && tracker.pageDomain !== "unknown") {
      protectedSites.add(getSiteControlKey(tracker.pageDomain));
    }
  }

  return {
    blockedRequestCount,
    protectedSiteCount: protectedSites.size
  };
}

function calculatePrivacyAssessment(siteEntries) {
  if (siteEntries.length === 0) {
    return {
      score: 100,
      signals: [],
      categoryCount: 0,
      companyCount: 0
    };
  }

  let score = 100;
  const categories = new Set();
  const companies = new Set();
  const signals = new Set();

  for (const entry of siteEntries) {
    const requestCount = entry.requestCount || 0;
    const requestPenalty = 4 + Math.min(10, Math.log2(requestCount + 1) * 2.5);
    const riskPenalty = (entry.riskScore || 0) * 0.18;
    const fingerprintPenalty = (entry.fingerprinting || 0) * 2.5;
    const cookiePenalty = Math.min(6, (entry.cookies || 0) * 40);
    let categoryPenalty = 0;

    companies.add(entry.company || "Unknown company");

    for (const category of entry.categories || []) {
      categories.add(category);
      if (HIGH_RISK_CATEGORIES.has(category)) {
        categoryPenalty = Math.max(categoryPenalty, 6);
      }
    }

    if ((entry.fingerprinting || 0) >= 2) {
      signals.add("fingerprinting");
    }

    if ((entry.cookies || 0) >= 0.05) {
      signals.add("cookie pressure");
    }

    if ((entry.prevalence || 0) >= 0.1) {
      signals.add("web-wide prevalence");
    }

    if ((entry.categories || []).includes("Session Replay")) {
      signals.add("session replay");
    }

    if ((entry.categories || []).includes("Action Pixels")) {
      signals.add("conversion pixels");
    }

    if ((entry.categories || []).includes("Malware")) {
      signals.add("malware risk");
    }

    score -= requestPenalty + riskPenalty + fingerprintPenalty + cookiePenalty + categoryPenalty;
  }

  score -= Math.min(12, companies.size * 2.5);
  score -= Math.min(10, categories.size * 1.5);

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    signals: [...signals],
    categoryCount: categories.size,
    companyCount: companies.size
  };
}

function getPrivacyScoreMeta(siteEntries, assessment) {
  if (siteEntries.length === 0) {
    return {
      badgeClass: "score-badge score-badge--strong",
      caption: "No known tracker requests have been blocked on this site yet."
    };
  }

  if (assessment.score >= 80) {
    return {
      badgeClass: "score-badge score-badge--strong",
      caption: "This site looks relatively quiet, with lower-risk trackers or fewer blocked requests."
    };
  }

  if (assessment.score >= 55) {
    return {
      badgeClass: "score-badge score-badge--fair",
      caption: "This site has meaningful tracking activity, but the blocker is cutting off a good portion of it."
    };
  }

  return {
    badgeClass: "score-badge score-badge--risky",
    caption: "This site is heavily instrumented for tracking. Blocking is helping, but the privacy pressure is high."
  };
}

function renderTrackerList(companySummary, siteDomain, disabledMessage = "") {
  if (disabledMessage) {
    trackerListElement.replaceChildren(createEmptyState(disabledMessage));
    return;
  }

  if (!siteDomain) {
    trackerListElement.replaceChildren(createEmptyState("Open a website tab to inspect blocked companies."));
    return;
  }

  if (companySummary.length === 0) {
    trackerListElement.replaceChildren(createEmptyState("No blocked trackers on this site yet."));
    return;
  }

  trackerListElement.replaceChildren(
    ...companySummary.map((tracker) => {
      const item = document.createElement("li");
      const company = document.createElement("span");
      const meta = document.createElement("span");
      const categoryPreview = [...tracker.categories].slice(0, 2).join(", ");

      item.className = "tracker-list__item";
      company.className = "tracker-list__company";
      meta.className = "tracker-list__meta";
      company.textContent = tracker.company;
      meta.textContent = categoryPreview
        ? `${tracker.requestCount} blocked request${tracker.requestCount === 1 ? "" : "s"} - ${categoryPreview}`
        : `${tracker.requestCount} blocked request${tracker.requestCount === 1 ? "" : "s"}`;
      item.append(company, meta);

      return item;
    })
  );
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return "";
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function getProtectionStatus(state, siteDomain) {
  const siteKey = getSiteControlKey(siteDomain);

  if (state.extensionEnabled === false) {
    return {
      label: "Extension off",
      detail: "Blocking, scoring, badge counts, cleanup helpers, and persona activity are switched off."
    };
  }

  if (!siteDomain) {
    return {
      label: "Waiting for a website",
      detail: "Open a website tab to manage protection controls."
    };
  }

  if (state.protectionPauseUntil && state.protectionPauseUntil > Date.now()) {
    return {
      label: "Protection paused",
      detail: `Blocking is disabled everywhere until ${formatRelativeTime(state.protectionPauseUntil)}.`
    };
  }

  if ((state.trustedSites || []).includes(siteKey)) {
    return {
      label: "Trusted permanently",
      detail: "Blocking is off for this site until you remove it from the allowlist."
    };
  }

  if ((state.pausedSites || []).includes(siteKey)) {
    return {
      label: "Paused on this site",
      detail: "Blocking is paused only for this site."
    };
  }

  return {
    label: "Blocking active",
    detail: "Known third-party trackers are being blocked on this site."
  };
}

function getCleanupStatus(state, siteDomain) {
  const summary = state.lastCleanupSummary;

  if (!summary || !siteDomain || getSiteControlKey(summary.siteDomain) !== getSiteControlKey(siteDomain)) {
    return "Cleanup tools remove site data and tracker cookies for the current site.";
  }

  const timeText = formatRelativeTime(summary.timestamp);
  const baseMessage = String(summary.message || "").replace(/\.+$/, "");
  return timeText ? `${baseMessage} at ${timeText}.` : baseMessage;
}

function updateButtons(state, siteDomain) {
  const siteKey = getSiteControlKey(siteDomain);
  const extensionEnabled = state.extensionEnabled !== false;
  const trusted = siteKey && (state.trustedSites || []).includes(siteKey);
  const paused = siteKey && (state.pausedSites || []).includes(siteKey);
  const protectionPaused = Boolean(state.protectionPauseUntil && state.protectionPauseUntil > Date.now());
  const hasSite = Boolean(siteDomain);

  pauseSiteButton.disabled = !extensionEnabled || !hasSite;
  trustSiteButton.disabled = !extensionEnabled || !hasSite;
  pauseProtectionButton.disabled = !extensionEnabled;
  clearSiteDataButton.disabled = !extensionEnabled || !hasSite;
  clearTrackerCookiesButton.disabled = !extensionEnabled || !hasSite;

  pauseSiteButton.textContent = paused ? "Resume Site" : "Pause Site";
  trustSiteButton.textContent = trusted ? "Untrust Site" : "Trust Site";
  pauseProtectionButton.textContent = protectionPaused ? "Resume Protection" : "Disable 30 Minutes";
}

async function getActiveTabContext() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const url = activeTab?.url || "";

  if (!/^https?:\/\//i.test(url)) {
    return {
      tabId: activeTab?.id ?? null,
      siteDomain: "",
      origin: ""
    };
  }

  const parsedUrl = new URL(url);

  return {
    tabId: activeTab?.id ?? null,
    siteDomain: parsedUrl.hostname.toLowerCase(),
    origin: parsedUrl.origin
  };
}

function updateUi(state, tabContext) {
  const extensionEnabled = state.extensionEnabled !== false;
  const blockedTrackers = Array.isArray(state.blockedTrackers) ? state.blockedTrackers : [];
  const siteEntries = extensionEnabled ? getActiveSiteEntries(blockedTrackers, tabContext.siteDomain) : [];
  const companySummary = buildCompanySummary(siteEntries);
  const overallSummary = buildOverallSummary(blockedTrackers);
  const blockedRequestCount = siteEntries.reduce((total, item) => total + (item.requestCount || 0), 0);
  const assessment = calculatePrivacyAssessment(siteEntries);
  const privacyScoreMeta = extensionEnabled
    ? getPrivacyScoreMeta(siteEntries, assessment)
    : {
      badgeClass: "score-badge score-badge--off",
      caption: "Digital Decoy is switched off. Turn it on to resume blocking and scoring."
    };
  const protectionStatus = getProtectionStatus(state, tabContext.siteDomain);

  extensionStatusElement.textContent = extensionEnabled ? "On" : "Off";
  extensionStatusElement.className = extensionEnabled ? "badge badge--on" : "badge badge--off";
  toggleExtensionButton.textContent = extensionEnabled ? "Turn Extension Off" : "Turn Extension On";
  toggleExtensionButton.className = extensionEnabled ? "button button--danger" : "button";
  masterSwitchDetailElement.textContent = extensionEnabled
    ? "Digital Decoy is protecting active websites."
    : "Everything is disabled until you turn the extension back on.";
  protectionModeBadgeElement.textContent = extensionEnabled ? "Active" : "Off";
  protectionModeBadgeElement.className = extensionEnabled ? "badge badge--on" : "badge badge--off";
  siteDomainElement.textContent = tabContext.siteDomain || "No active website";
  siteStatusElement.textContent = protectionStatus.label;
  siteControlDetailElement.textContent = protectionStatus.detail;
  scoreCaptionElement.textContent = extensionEnabled && tabContext.siteDomain
    ? privacyScoreMeta.caption
    : extensionEnabled
      ? "Open a website tab to inspect its privacy posture."
      : privacyScoreMeta.caption;
  scoreSignalsElement.textContent = !extensionEnabled
    ? "Protection is disabled."
    : assessment.signals.length > 0
    ? `Signals: ${assessment.signals.join(", ")}.`
    : "No high-risk signals detected yet.";
  privacyScoreValueElement.textContent = extensionEnabled ? String(assessment.score) : "Off";
  privacyScoreBadgeElement.className = privacyScoreMeta.badgeClass;
  blockedRequestCountElement.textContent = String(blockedRequestCount);
  blockedCompanyCountElement.textContent = String(companySummary.length);
  overallBlockedCountElement.textContent = String(overallSummary.blockedRequestCount);
  protectedSiteCountElement.textContent = String(overallSummary.protectedSiteCount);
  cleanupStatusElement.textContent = extensionEnabled
    ? getCleanupStatus(state, tabContext.siteDomain)
    : "Cleanup helpers are disabled while Digital Decoy is off.";
  renderTrackerList(
    companySummary,
    tabContext.siteDomain,
    extensionEnabled ? "" : "Digital Decoy is off. Turn it on to see blocked companies."
  );
  updateButtons(state, tabContext.siteDomain);

  personaNameElement.textContent = formatPersonaName(state.selectedPersona || "gardener");
  sessionStatusElement.textContent = !extensionEnabled ? "Off" : state.personaSessionActive ? "Running" : "Idle";
  scheduleTextElement.textContent = formatScheduleText(state);
  personaSelectElement.value = state.selectedPersona || "gardener";
  personaSelectElement.disabled = !extensionEnabled;
  customKeywordsContainer.style.display = state.selectedPersona === "custom" ? "block" : "none";
  if (state.customKeywords && customKeywordsInput.value !== state.customKeywords) {
    customKeywordsInput.value = state.customKeywords;
  }
  customKeywordsInput.disabled = !extensionEnabled;
  deceptionStatusElement.textContent = extensionEnabled && state.deceptionEnabled ? "On" : "Off";
  deceptionStatusElement.className = extensionEnabled && state.deceptionEnabled ? "badge badge--on" : "badge badge--off";
  toggleButton.disabled = !extensionEnabled;
  toggleButton.textContent = !extensionEnabled
    ? "Enable Extension First"
    : state.deceptionEnabled ? "Disable Deception" : "Enable Deception";
}

async function loadState() {
  const [state, tabContext] = await Promise.all([
    chrome.runtime.sendMessage({ type: "digital-decoy:get-state" }),
    getActiveTabContext()
  ]);

  currentState = state;
  currentTabContext = tabContext;
  updateUi(state, tabContext);
}

async function sendBackgroundAction(message) {
  return chrome.runtime.sendMessage(message);
}

toggleExtensionButton.addEventListener("click", async () => {
  const extensionEnabled = currentState?.extensionEnabled !== false;

  await sendBackgroundAction({
    type: "digital-decoy:set-extension-enabled",
    extensionEnabled: !extensionEnabled,
    siteDomain: currentTabContext.siteDomain,
    tabId: currentTabContext.tabId
  });
  await loadState();
});

openDashboardButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
});

pauseSiteButton.addEventListener("click", async () => {
  if (!currentTabContext.siteDomain) {
    return;
  }

  const siteKey = getSiteControlKey(currentTabContext.siteDomain);
  const isPaused = (currentState?.pausedSites || []).includes(siteKey);
  await sendBackgroundAction({
    type: isPaused ? "digital-decoy:resume-site" : "digital-decoy:pause-site",
    siteDomain: currentTabContext.siteDomain,
    tabId: currentTabContext.tabId
  });
  await loadState();
});

trustSiteButton.addEventListener("click", async () => {
  if (!currentTabContext.siteDomain) {
    return;
  }

  const siteKey = getSiteControlKey(currentTabContext.siteDomain);
  const isTrusted = (currentState?.trustedSites || []).includes(siteKey);
  await sendBackgroundAction({
    type: isTrusted ? "digital-decoy:untrust-site" : "digital-decoy:trust-site",
    siteDomain: currentTabContext.siteDomain,
    tabId: currentTabContext.tabId
  });
  await loadState();
});

pauseProtectionButton.addEventListener("click", async () => {
  const protectionPaused = Boolean(currentState?.protectionPauseUntil && currentState.protectionPauseUntil > Date.now());

  await sendBackgroundAction({
    type: protectionPaused ? "digital-decoy:resume-protection" : "digital-decoy:pause-protection",
    tabId: currentTabContext.tabId,
    siteDomain: currentTabContext.siteDomain
  });
  await loadState();
});

clearSiteDataButton.addEventListener("click", async () => {
  if (!currentTabContext.siteDomain) {
    return;
  }

  await sendBackgroundAction({
    type: "digital-decoy:clear-site-data",
    siteDomain: currentTabContext.siteDomain
  });
  await loadState();
});

clearTrackerCookiesButton.addEventListener("click", async () => {
  if (!currentTabContext.siteDomain) {
    return;
  }

  await sendBackgroundAction({
    type: "digital-decoy:clear-tracker-cookies",
    siteDomain: currentTabContext.siteDomain
  });
  await loadState();
});

toggleButton.addEventListener("click", async () => {
  const { deceptionEnabled = false } = await chrome.storage.local.get("deceptionEnabled");
  const nextValue = !deceptionEnabled;

  await chrome.storage.local.set({ deceptionEnabled: nextValue });
  await loadState();
});

personaSelectElement.addEventListener("change", async (event) => {
  await chrome.storage.local.set({ selectedPersona: event.target.value });
  await loadState();
});

customKeywordsInput.addEventListener("change", async (event) => {
  await chrome.storage.local.set({ customKeywords: event.target.value });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (
      changes.blockedTrackers ||
      changes.extensionEnabled ||
      changes.tabProtectionState ||
      changes.trustedSites ||
      changes.pausedSites ||
      changes.protectionPauseUntil ||
      changes.lastCleanupSummary ||
      changes.deceptionEnabled ||
      changes.selectedPersona ||
      changes.nextPersonaRunAt ||
      changes.lastPersonaRunAt ||
      changes.lastPersonaName ||
      changes.personaSessionActive
    )
  ) {
    loadState().catch(() => {});
  }
});

loadState();
