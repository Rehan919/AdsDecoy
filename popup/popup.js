const trackerCountElement = document.getElementById("tracker-count");
const trackerListElement = document.getElementById("tracker-list");
const deceptionStatusElement = document.getElementById("deception-status");
const personaNameElement = document.getElementById("persona-name");
const sessionStatusElement = document.getElementById("session-status");
const scheduleTextElement = document.getElementById("schedule-text");
const personaSelectElement = document.getElementById("persona-select");
const toggleButton = document.getElementById("toggle-deception");

function buildTrackerSummary(detectedTrackers) {
  if (!Array.isArray(detectedTrackers) || detectedTrackers.length === 0) {
    return [];
  }

  const summaryMap = new Map();

  for (const tracker of detectedTrackers) {
    const key = tracker.company || tracker.domain || "Unknown company";
    const current = summaryMap.get(key) || {
      company: key,
      requestCount: 0,
      siteCount: 0,
      sites: new Set()
    };

    current.requestCount += tracker.requestCount || 0;

    if (tracker.pageDomain) {
      current.sites.add(tracker.pageDomain);
    }

    current.siteCount = current.sites.size;
    summaryMap.set(key, current);
  }

  return [...summaryMap.values()].sort((left, right) => right.requestCount - left.requestCount);
}

function renderTrackerList(detectedTrackers) {
  const trackerSummary = buildTrackerSummary(detectedTrackers);

  if (trackerSummary.length === 0) {
    trackerListElement.replaceChildren(createEmptyState());
    return;
  }

  trackerListElement.replaceChildren(
    ...trackerSummary.map((tracker) => {
      const item = document.createElement("li");
      const company = document.createElement("span");
      const meta = document.createElement("span");

      item.className = "tracker-list__item";
      company.className = "tracker-list__company";
      meta.className = "tracker-list__meta";
      company.textContent = tracker.company;
      meta.textContent = `${tracker.requestCount} request${tracker.requestCount === 1 ? "" : "s"} across ${tracker.siteCount} site${tracker.siteCount === 1 ? "" : "s"}`;
      item.append(company, meta);

      return item;
    })
  );
}

function createEmptyState() {
  const item = document.createElement("li");
  item.className = "tracker-list__empty";
  item.textContent = "No trackers detected yet.";
  return item;
}

function formatPersonaName(personaName) {
  if (!personaName) {
    return "Gardener";
  }

  return personaName.charAt(0).toUpperCase() + personaName.slice(1);
}

function formatScheduleText(state) {
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

function updateUi(state) {
  const trackerSummary = buildTrackerSummary(state.detectedTrackers);
  const trackerCount = trackerSummary.length;

  trackerCountElement.textContent = String(trackerCount);
  renderTrackerList(state.detectedTrackers);
  personaNameElement.textContent = formatPersonaName(state.selectedPersona || "gardener");
  sessionStatusElement.textContent = state.personaSessionActive ? "Running" : "Idle";
  scheduleTextElement.textContent = formatScheduleText(state);
  personaSelectElement.value = state.selectedPersona || "gardener";
  deceptionStatusElement.textContent = state.deceptionEnabled ? "On" : "Off";
  deceptionStatusElement.className = state.deceptionEnabled ? "badge badge--on" : "badge badge--off";
  toggleButton.textContent = state.deceptionEnabled ? "Disable Deception" : "Enable Deception";
}

async function loadState() {
  const state = await chrome.runtime.sendMessage({ type: "digital-decoy:get-state" });
  updateUi(state);
}

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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (
      changes.detectedTrackers ||
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
