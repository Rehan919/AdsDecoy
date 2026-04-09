"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const DOMAIN_MAP_URL = "https://raw.githubusercontent.com/duckduckgo/tracker-radar/main/build-data/generated/domain_map.json";
const CATEGORIZED_TRACKERS_URL = "https://raw.githubusercontent.com/duckduckgo/tracker-radar/main/build-data/static/categorized_trackers.csv";
const DOMAIN_DETAILS_URL_PREFIX = "https://raw.githubusercontent.com/duckduckgo/tracker-radar/main/domains/US/";
const OUTPUT_PATH = path.join(__dirname, "..", "data", "tracker_map.json");
const CATALOG_OUTPUT_PATH = path.join(__dirname, "..", "data", "tracker_catalog.json");
const FETCH_CONCURRENCY = 10;

const TRACKING_CATEGORIES = new Set([
  "Ad Motivated Tracking",
  "Advertising",
  "Ad Fraud",
  "Analytics",
  "Audience Measurement",
  "Federated Login",
  "SSO",
  "Third-Party Analytics Marketing",
  "Social - Comment",
  "Social - Share",
  "Action Pixels",
  "Unknown High Risk Behavior",
  "Obscure Ownership",
  "Session Replay",
  "Social Network",
  "Malware",
  "Tag Manager"
]);
const CATEGORY_WEIGHTS = {
  "Ad Motivated Tracking": 16,
  "Advertising": 14,
  "Ad Fraud": 12,
  "Analytics": 8,
  "Audience Measurement": 7,
  "Federated Login": 5,
  "SSO": 5,
  "Third-Party Analytics Marketing": 10,
  "Social - Comment": 6,
  "Social - Share": 6,
  "Action Pixels": 12,
  "Unknown High Risk Behavior": 18,
  "Obscure Ownership": 11,
  "Session Replay": 18,
  "Social Network": 8,
  "Malware": 25,
  "Tag Manager": 6
};

function downloadText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "Digital-Decoy/0.2.0"
          }
        },
        (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            resolve(downloadText(response.headers.location));
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Request failed for ${url}: ${response.statusCode}`));
            response.resume();
            return;
          }

          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => resolve(body));
        }
      )
      .on("error", reject);
  });
}

function parseCsv(text) {
  const rows = [];
  let currentField = "";
  let currentRow = [];
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === "\"") {
      if (insideQuotes && nextCharacter === "\"") {
        currentField += "\"";
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }

      continue;
    }

    if (character === "," && !insideQuotes) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentField);
      currentField = "";

      if (currentRow.some((value) => value !== "")) {
        rows.push(currentRow);
      }

      currentRow = [];
      continue;
    }

    currentField += character;
  }

  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((value) => value !== "")) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function csvRowsToObjects(rows) {
  if (rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;

  return dataRows.map((row) => {
    const entry = {};

    for (let index = 0; index < header.length; index += 1) {
      entry[header[index]] = row[index] || "";
    }

    return entry;
  });
}

function hasTrackingSignal(row) {
  if (row["Non-Tracking"] === "1") {
    return false;
  }

  for (const category of TRACKING_CATEGORIES) {
    if (row[category] === "1") {
      return true;
    }
  }

  return false;
}

function buildTrackerMap(domainMap, categorizedTrackers) {
  const trackerMap = {};

  for (const row of categorizedTrackers) {
    const domain = (row.domain || "").trim().toLowerCase();

    if (!domain || !hasTrackingSignal(row)) {
      continue;
    }

    const domainInfo = domainMap[domain];
    const displayName = domainInfo?.displayName || domainInfo?.entityName || domain;
    trackerMap[domain] = displayName;
  }

  return Object.fromEntries(
    Object.entries(trackerMap).sort(([leftDomain], [rightDomain]) => leftDomain.localeCompare(rightDomain))
  );
}

function getTrackingCategories(row) {
  return Object.keys(row).filter((key) => TRACKING_CATEGORIES.has(key) && row[key] === "1");
}

function normalizeScore(value, maxValue) {
  if (!value || !maxValue) {
    return 0;
  }

  return Math.max(0, Math.min(1, value / maxValue));
}

function calculateRiskScore(metadata) {
  const categoryScore = Math.min(
    45,
    metadata.categories.reduce((total, category) => total + (CATEGORY_WEIGHTS[category] || 4), 0)
  );
  const prevalenceScore = normalizeScore(metadata.prevalence, 0.2) * 20;
  const cookieScore = normalizeScore(metadata.cookies, 0.15) * 15;
  const fingerprintingScore = normalizeScore(metadata.fingerprinting, 3) * 20;

  return Math.round(Math.min(100, categoryScore + prevalenceScore + cookieScore + fingerprintingScore));
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

async function fetchDomainDetails(domain) {
  const detailUrl = `${DOMAIN_DETAILS_URL_PREFIX}${encodeURIComponent(domain)}.json`;

  try {
    const detailText = await downloadText(detailUrl);
    const details = JSON.parse(detailText);

    return {
      prevalence: Number(details.prevalence) || 0,
      fingerprinting: Number(details.fingerprinting) || 0,
      cookies: Number(details.cookies) || 0,
      sites: Number(details.sites) || 0,
      categories: Array.isArray(details.categories) ? details.categories : [],
      ownerName: details.owner?.name || "",
      ownerDisplayName: details.owner?.displayName || ""
    };
  } catch {
    return {
      prevalence: 0,
      fingerprinting: 0,
      cookies: 0,
      sites: 0,
      categories: [],
      ownerName: "",
      ownerDisplayName: ""
    };
  }
}

async function buildTrackerCatalog(domainMap, categorizedTrackers) {
  const trackedRows = categorizedTrackers.filter((row) => {
    const domain = (row.domain || "").trim().toLowerCase();
    return domain && hasTrackingSignal(row);
  });

  const detailsList = await mapWithConcurrency(trackedRows, FETCH_CONCURRENCY, async (row) => {
    const domain = row.domain.trim().toLowerCase();
    const domainInfo = domainMap[domain] || {};
    const details = await fetchDomainDetails(domain);
    const categories = [...new Set([...getTrackingCategories(row), ...details.categories])];
    const company = details.ownerDisplayName || domainInfo.displayName || domainInfo.entityName || domain;
    const ownerName = details.ownerName || domainInfo.entityName || company;
    const primaryCategory = categories[0] || "Unknown";
    const metadata = {
      company,
      ownerName,
      primaryCategory,
      categories,
      prevalence: details.prevalence,
      fingerprinting: details.fingerprinting,
      cookies: details.cookies,
      sites: details.sites
    };

    return [
      domain,
      {
        ...metadata,
        riskScore: calculateRiskScore(metadata)
      }
    ];
  });

  return Object.fromEntries(
    detailsList.sort(([leftDomain], [rightDomain]) => leftDomain.localeCompare(rightDomain))
  );
}

async function main() {
  const [domainMapText, categorizedTrackersText] = await Promise.all([
    downloadText(DOMAIN_MAP_URL),
    downloadText(CATEGORIZED_TRACKERS_URL)
  ]);

  const domainMap = JSON.parse(domainMapText);
  const categorizedTrackers = csvRowsToObjects(parseCsv(categorizedTrackersText));
  const trackerCatalog = await buildTrackerCatalog(domainMap, categorizedTrackers);
  const trackerMap = Object.fromEntries(
    Object.entries(trackerCatalog).map(([domain, metadata]) => [domain, metadata.company])
  );

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(trackerMap, null, 2)}\n`, "utf8");
  fs.writeFileSync(CATALOG_OUTPUT_PATH, `${JSON.stringify(trackerCatalog, null, 2)}\n`, "utf8");
  console.log(
    `Generated ${Object.keys(trackerMap).length} tracker mappings and ${Object.keys(trackerCatalog).length} catalog entries from DuckDuckGo Tracker Radar.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
