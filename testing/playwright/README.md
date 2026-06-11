# Playwright Dashboard Tests

End-to-end tests for [gamerslab.space](https://gamerslab.space) using Playwright.

## Setup

```bash
cd testing/playwright
npm install
npx playwright install chromium
```

## Auth bypass

The dashboard is password-protected. Tests bypass this by injecting the password hash directly into `sessionStorage` before React mounts — no need to know the actual password, only its SHA-256 hash.

Get the hash from Cloudflare Pages environment variables (Settings → Environment Variables → `VITE_PASS_HASH`).

Create `testing/playwright/.env`:
```bash
DASHBOARD_URL=https://gamerslab.space
DASHBOARD_PASS_HASH=<value of VITE_PASS_HASH from Cloudflare Pages>
```

Load and run:
```bash
export $(grep -v '^#' .env | xargs)
npx playwright test
```

Or pass inline:
```bash
DASHBOARD_PASS_HASH=abc123... npx playwright test
```

## Running tests

```bash
# Run all tests headless
npx playwright test

# Run with browser visible
npx playwright test --headed

# Run a single test file
npx playwright test dashboard.spec.js

# Debug mode (step through)
npx playwright test --debug

# Interactive UI mode
npx playwright test --ui

# View last report
npx playwright show-report playwright-report
```

## What is tested

### Auth
- Lock screen shown when no auth in sessionStorage
- sessionStorage bypass correctly grants access

### Monitor page
- Loads without JS errors
- All 4 stat cards visible (monitor checks, uptime, avg ttfb, surge runs)
- Time range selector buttons work (1h / 24h / 7d / 30d)
- Refresh button works without crash
- Live feed rows expand to show Playwright detail

### Control page
- Loads without JS errors
- All cards visible (manual triggers, schedule, referrers, surge scheduler, target, Discord)
- Active target shown with Bug Seek name
- Click-check slider renders and displays a valid % value
- **Slider save persists across page reload** (the bug this catches)
- Referrer list shows BugnSeek and others
- Referrer toggle does not throw
- Surge scheduler shows date picker with future minimum
- Manual trigger buttons are enabled
- Discord test button is present

### Navigation
- Nav tabs switch between Monitor and Control
- Direct URL to /control works

### No console errors
- Both pages pass a dedicated check for unfiltered JS errors

## Notes on filtered errors

The following console errors are intentionally ignored — they come from third-party scripts (Cloudflare Insights, itch.io) and are not bugs in the dashboard:

- `Permissions-Policy` header warnings
- `ERR_BLOCKED_BY_CLIENT` (ad blockers blocking Cloudflare beacon)
- `net::ERR_*` network errors to external domains
- `favicon` 404s

Anything not in this list will fail the "no console errors" tests.
