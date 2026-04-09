# Digital Decoy

Digital Decoy is a Chromium Manifest V3 browser extension that blocks known third-party trackers, shows which companies were blocked, scores site privacy in the popup, and can optionally generate persona-based browsing noise on a randomized schedule.

## Features

- Blocks known third-party trackers with Manifest V3 network rules
- Shows blocked companies for the current site
- Calculates a richer per-site privacy score using Tracker Radar metadata
- Aggregates blocked requests by company for clearer reporting
- Supports a site allowlist with permanent trust and per-site pause controls
- Supports a 30-minute global protection pause
- Shows live blocked-request badge counts on the extension icon
- Includes cleanup helpers for current-site data and blocked tracker cookies
- Supports selectable personas for optional deception browsing
- Runs persona sessions at randomized intervals with hourly limits
- Stores extension state locally with `chrome.storage.local`

## Current Behavior

### Tracker Protection

- Loads a local tracker dataset from `data/tracker_map.json`
- Installs blocking rules with `chrome.declarativeNetRequest`
- Filters invalid or non-page-linked requests before reporting
- Stores recent blocked activity with company and site context
- Uses DuckDuckGo Tracker Radar as the upstream tracker-company source

### Privacy Scoring

- Uses blocked request counts plus Tracker Radar risk metadata
- Weighs domain prevalence, fingerprinting likelihood, cookie behavior, and tracker categories
- Highlights tracker-heavy pages immediately in the popup

### Site Controls

- Trust a site permanently to stop blocking on that site
- Pause blocking for the current site without allowlisting it permanently
- Disable blocking everywhere for 30 minutes
- Show live blocked-request badge counts per tab

### Cleanup Helpers

- Clear current-site cookies and storage data
- Clear cookies for blocked tracker domains seen on the current site

### Persona Deception

- Personas currently included:
  - Gardener
  - Executive
  - Student
- Randomized schedule:
  - Interval: 10 to 20 minutes
  - Pages per session: 1 to 3
  - Dwell time per page: 20 to 60 seconds
- Safety limit:
  - Maximum 2 sessions per hour

## Packaged Download

- A packaged archive named `AdsDecoy-package.zip` is included in the repository root for simple download and transfer.
- Git cloning still works normally with the full source tree.

## Project Structure

```text
Digital-Decoy/
|- manifest.json
|- background/
|  \- tracker_detector.js
|- data/
|  |- tracker_catalog.json
|  \- tracker_map.json
|- scripts/
|  \- update_tracker_map.js
|- icons/
|  \- .gitkeep
|- persona/
|  |- persona_data.js
|  \- persona_engine.js
|- popup/
|  |- popup.html
|  |- popup.css
|  \- popup.js
|- utils/
|  \- domain_matcher.js
|- LICENSE
\- NOTICE.md
\- README.md
```

## Permissions

The extension currently requests:

- `declarativeNetRequest`
- `declarativeNetRequestFeedback`
- `storage`
- `tabs`
- `browsingData`
- `webRequest`
- `alarms`
- `host_permissions: <all_urls>`

## Installation

1. Open `chrome://extensions`, `edge://extensions`, or `brave://extensions`
2. Enable Developer Mode
3. Click Load unpacked
4. Select the project folder

## Usage

1. Load the extension
2. Open the popup
3. Browse normally
4. Open the popup to review the current site privacy score and blocked companies
5. Choose a persona and enable deception mode if desired

## Dataset Updates

- The tracker-company map is generated from DuckDuckGo Tracker Radar.
- The richer tracker catalog is generated into `data/tracker_catalog.json`.
- To refresh it, run `node scripts/update_tracker_map.js`
- The generated datasets are written to `data/tracker_map.json` and `data/tracker_catalog.json`

## Attribution

- Tracker data source: [DuckDuckGo Tracker Radar](https://github.com/duckduckgo/tracker-radar)
- Additional license details: `NOTICE.md`

## Notes

- The extension is designed for Chromium-based browsers
- Icons are still placeholders and can be replaced with production assets later
- The repository includes both the normal source tree and a packaged ZIP archive

## License

MIT
