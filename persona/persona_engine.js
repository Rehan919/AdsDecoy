(function attachPersonaEngine(globalScope) {
  const { DEFAULT_PERSONA, getPersonaSites, hasPersona } = globalScope.PersonaData;
  const SESSION_ALARM_NAME = "digital-decoy:persona-session";
  const STEP_ALARM_NAME = "digital-decoy:persona-step";
  const MIN_INTERVAL_MINUTES = 10;
  const MAX_INTERVAL_MINUTES = 20;
  const MIN_PAGES_PER_SESSION = 1;
  const MAX_PAGES_PER_SESSION = 3;
  const MIN_DWELL_SECONDS = 20;
  const MAX_DWELL_SECONDS = 60;
  const MAX_SESSIONS_PER_HOUR = 2;
  let sessionTransitionInFlight = false;

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pickSessionUrls(personaName) {
    const availableUrls = [...getPersonaSites(personaName)];
    const sessionLength = Math.min(
      availableUrls.length,
      randomInt(MIN_PAGES_PER_SESSION, MAX_PAGES_PER_SESSION)
    );
    const selectedUrls = [];

    while (selectedUrls.length < sessionLength && availableUrls.length > 0) {
      const nextIndex = randomInt(0, availableUrls.length - 1);
      selectedUrls.push(availableUrls.splice(nextIndex, 1)[0]);
    }

    return selectedUrls;
  }

  async function persistPersonaState(nextState) {
    await chrome.storage.local.set(nextState);
  }

  function trimSessionHistory(sessionHistory, now) {
    const cutoff = now - 60 * 60 * 1000;
    return Array.isArray(sessionHistory) ? sessionHistory.filter((timestamp) => timestamp > cutoff) : [];
  }

  async function getTrimmedSessionHistory() {
    const now = Date.now();
    const state = await chrome.storage.local.get(["personaSessionHistory"]);
    const trimmedHistory = trimSessionHistory(state.personaSessionHistory, now);

    if ((state.personaSessionHistory || []).length !== trimmedHistory.length) {
      await persistPersonaState({ personaSessionHistory: trimmedHistory });
    }

    return trimmedHistory;
  }

  async function scheduleNextPersonaSession() {
    const delayInMinutes = randomInt(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
    const nextRunAt = Date.now() + delayInMinutes * 60 * 1000;

    await chrome.alarms.clear(SESSION_ALARM_NAME);
    chrome.alarms.create(SESSION_ALARM_NAME, { delayInMinutes });
    await persistPersonaState({ nextPersonaRunAt: nextRunAt });

    return nextRunAt;
  }

  async function openNoiseTab(url) {
    return chrome.tabs.create({
      url,
      active: false
    });
  }

  async function closeNoiseTab(tabId) {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // Tab may already be gone, which is safe to ignore.
    }
  }

  async function stopPersonaSessionSchedule() {
    await chrome.alarms.clear(SESSION_ALARM_NAME);
    await chrome.alarms.clear(STEP_ALARM_NAME);

    const state = await chrome.storage.local.get([
      "personaActiveTabId"
    ]);

    if (typeof state.personaActiveTabId === "number") {
      await closeNoiseTab(state.personaActiveTabId);
    }

    await persistPersonaState({
      nextPersonaRunAt: null,
      personaSessionActive: false,
      personaSessionQueue: [],
      personaActiveTabId: null
    });
  }

  async function runPersonaSession() {
    if (sessionTransitionInFlight) {
      return;
    }

    sessionTransitionInFlight = true;
    try {
      const state = await chrome.storage.local.get([
        "deceptionEnabled",
        "selectedPersona",
        "personaSessionActive"
      ]);

      if (!state.deceptionEnabled) {
        await stopPersonaSessionSchedule();
        return;
      }

      if (state.personaSessionActive) {
        return;
      }

      const sessionHistory = await getTrimmedSessionHistory();

      if (sessionHistory.length >= MAX_SESSIONS_PER_HOUR) {
        await scheduleNextPersonaSession();
        return;
      }

      const personaName = hasPersona(state.selectedPersona) ? state.selectedPersona : DEFAULT_PERSONA;
      const sessionUrls = pickSessionUrls(personaName);

      if (sessionUrls.length === 0) {
        await scheduleNextPersonaSession();
        return;
      }

      const currentUrl = sessionUrls[0];
      const remainingUrls = sessionUrls.slice(1);
      const dwellSeconds = randomInt(MIN_DWELL_SECONDS, MAX_DWELL_SECONDS);
      const tab = await openNoiseTab(currentUrl);

      await persistPersonaState({
        personaSessionActive: true,
        lastPersonaRunAt: Date.now(),
        lastPersonaName: personaName,
        lastPersonaSessionSize: sessionUrls.length,
        personaSessionQueue: remainingUrls,
        personaActiveTabId: typeof tab.id === "number" ? tab.id : null,
        personaSessionHistory: [...sessionHistory, Date.now()],
        nextPersonaRunAt: null
      });
      await chrome.alarms.clear(STEP_ALARM_NAME);
      chrome.alarms.create(STEP_ALARM_NAME, { when: Date.now() + dwellSeconds * 1000 });
    } finally {
      sessionTransitionInFlight = false;
    }
  }

  async function syncPersonaEngine(forceReschedule) {
    const state = await chrome.storage.local.get([
      "deceptionEnabled",
      "selectedPersona",
      "nextPersonaRunAt",
      "personaSessionActive",
      "personaActiveTabId"
    ]);

    const personaName = hasPersona(state.selectedPersona) ? state.selectedPersona : DEFAULT_PERSONA;

    if (personaName !== state.selectedPersona) {
      await persistPersonaState({ selectedPersona: personaName });
    }

    if (!state.deceptionEnabled) {
      await stopPersonaSessionSchedule();
      return;
    }

    if (state.personaSessionActive) {
      const stepAlarm = await chrome.alarms.get(STEP_ALARM_NAME);

      if (stepAlarm) {
        return;
      }

      if (typeof state.personaActiveTabId === "number") {
        await closeNoiseTab(state.personaActiveTabId);
      }

      await persistPersonaState({
        personaSessionActive: false,
        personaSessionQueue: [],
        personaActiveTabId: null
      });
    }

    const activeAlarm = await chrome.alarms.get(SESSION_ALARM_NAME);

    if (!activeAlarm || forceReschedule) {
      await scheduleNextPersonaSession();
    }
  }

  async function advancePersonaSession() {
    if (sessionTransitionInFlight) {
      return;
    }

    sessionTransitionInFlight = true;
    try {
      const state = await chrome.storage.local.get([
        "deceptionEnabled",
        "personaActiveTabId",
        "personaSessionQueue",
        "personaSessionActive"
      ]);

      if (!state.deceptionEnabled || !state.personaSessionActive) {
        await stopPersonaSessionSchedule();
        return;
      }

      if (typeof state.personaActiveTabId === "number") {
        await closeNoiseTab(state.personaActiveTabId);
      }

      const queue = Array.isArray(state.personaSessionQueue) ? [...state.personaSessionQueue] : [];

      if (queue.length === 0) {
        await persistPersonaState({
          personaSessionActive: false,
          personaSessionQueue: [],
          personaActiveTabId: null
        });
        await scheduleNextPersonaSession();
        return;
      }

      const nextUrl = queue.shift();
      const dwellSeconds = randomInt(MIN_DWELL_SECONDS, MAX_DWELL_SECONDS);
      const tab = await openNoiseTab(nextUrl);

      await persistPersonaState({
        personaSessionQueue: queue,
        personaActiveTabId: typeof tab.id === "number" ? tab.id : null
      });
      await chrome.alarms.clear(STEP_ALARM_NAME);
      chrome.alarms.create(STEP_ALARM_NAME, { when: Date.now() + dwellSeconds * 1000 });
    } finally {
      sessionTransitionInFlight = false;
    }
  }

  function registerPersonaAlarmListener() {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === SESSION_ALARM_NAME) {
        runPersonaSession().catch(async () => {
          sessionTransitionInFlight = false;
          await persistPersonaState({
            personaSessionActive: false,
            personaSessionQueue: [],
            personaActiveTabId: null
          });
          await scheduleNextPersonaSession();
        });
      }

      if (alarm.name === STEP_ALARM_NAME) {
        advancePersonaSession().catch(async () => {
          sessionTransitionInFlight = false;
          await persistPersonaState({
            personaSessionActive: false,
            personaSessionQueue: [],
            personaActiveTabId: null
          });
          await scheduleNextPersonaSession();
        });
      }
    });
  }

  globalScope.PersonaEngine = {
    registerPersonaAlarmListener,
    syncPersonaEngine
  };
})(globalThis);
