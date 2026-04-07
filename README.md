# Digital Decoy

Digital Decoy is a Chromium Manifest V3 browser extension that detects third-party trackers, maps them to the companies behind them, and can optionally generate persona-based browsing noise on a randomized schedule.

## Features

- Detects tracker requests on visited websites
- Maps tracker domains to human-readable company labels
- Bundles repeated detections into company-level counts in the popup
- Supports selectable personas for deception browsing
- Runs persona sessions at randomized intervals
- Uses configurable rate limits to prevent excessive deception activity
- Stores extension state locally with `chrome.storage.local`

## Current Behavior

### Tracker Detection

- Monitors outgoing web requests
- Filters invalid or non-page-linked requests
- Matches known tracker domains from the local dataset
- Stores recent detections with request counts and last-seen metadata

### Company Identification

- Uses `data/tracker_map.json`
- Groups repeated requests by company in the popup

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

## Project Structure

```text
Digital-Decoy/
├── manifest.json
├── background/
│   └── tracker_detector.js
├── data/
│   └── tracker_map.json
├── icons/
│   └── .gitkeep
├── persona/
│   ├── persona_data.js
│   └── persona_engine.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── utils/
│   └── domain_matcher.js
└── README.md
```

## Permissions

The extension currently requests:

- `declarativeNetRequest`
- `storage`
- `tabs`
- `scripting`
- `offscreen`
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
3. Choose a persona
4. Enable deception mode if desired
5. Browse normally
6. Review bundled company detections in the popup

## Notes

- The extension is designed for Chromium-based browsers
- Icons are still placeholders and can be replaced with production assets later
- Final release polish can still include packaging, icons, and broader QA

## License

No license file has been added yet.
