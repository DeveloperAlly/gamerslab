# GamersLab Geo Monitor — Testing Guide

Full architecture reference, test scripts, SQL verification queries, and manual test checklists for the GamersLab Geo Monitor pipeline.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SCHEDULING LAYER                         │
│                                                                 │
│  n8n  https://n8n-j39n.sliplane.app                             │
│  Workflow A  Schedule Trigger (5min) → 30% gate → GH dispatch  │
│  Workflow B  POST /webhook/surge → GH dispatch                  │
│  Workflow C  Schedule Trigger (30min) → Postgres → Discord      │
│  Workflow D  POST /webhook/update-target → Postgres             │
│  Workflow E  Schedule Trigger (2h) → 50% gate → GH dispatch     │
│  Workflow F  POST /webhook/schedule-surge → Postgres            │
│  Workflow G  Schedule Trigger (1min) → poll → GH dispatch       │
│                                                                 │
│  GitHub Actions cron (*/5 * * * *)  primary scheduling fallback │
└───────────────────────────────┬─────────────────────────────────┘
                                │ workflow_dispatch (GitHub API)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        EXECUTION LAYER                          │
│                                                                 │
│  GitHub Actions — .github/workflows/monitor.yml                 │
│  6 parallel matrix runners (ubuntu-latest, Node 24):            │
│  us-east · eu-west · ap-southeast · sa-east · me-south · af-south│
│                                                                 │
│  Each runner per run:                                           │
│  1. npm install playwright + chromium                           │
│  2. Fetch active target URL from Supabase at runtime            │
│  3. Fetch enabled referrers + click_check_percentage from SB    │
│  4. .github/scripts/monitor.js                                  │
│     a. Navigate to randomly-chosen referrer (dwell 2–4s)        │
│     b. Navigate to target URL  ← Referer header set naturally   │
│     c. Wait for game iframe (selectors: #game_drop etc.)        │
│     d. On % of runs: click "Run game" → check login prompt      │
│     e. Dwell 3–6s on page                                       │
│     f. Collect: TTFB, page_title, JS errors, blocked status     │
│  5. (surge mode only) .github/scripts/surge.js                  │
│     19 parallel Playwright browser contexts (120 total/run)     │
│  6. Python script pushes result row to Supabase                 │
└───────────────────────────────┬─────────────────────────────────┘
                                │ REST POST (service key)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                          DATA LAYER                             │
│                                                                 │
│  Supabase  project: bacumktnpozarnfvsrbw                        │
│  monitor_results   all check results (Playwright fields)        │
│  targets           active + historical target URLs              │
│  referrers         referrer simulation sources                  │
│  monitor_config    dashboard-controlled settings (key/value)    │
│  trigger_log       manual trigger audit log                     │
│  scheduled_surges  one-off surge event queue                    │
└───────────────────────────────┬─────────────────────────────────┘
                                │ REST GET (publishable key)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       DASHBOARD LAYER                           │
│                                                                 │
│  gamerslab.space  (Cloudflare Pages, React/Vite)                │
│  Monitor tab  stats cards, charts, region table, live feed      │
│               Playwright health banner: iframe · JS errors      │
│               · run-game click-check · browser visit count      │
│  Control tab  triggers, schedule, click-check %, referrers,     │
│               surge event scheduler, target URL, Discord        │
│                                                                 │
│  Cloudflare Worker  geo-monitor-worker.divine-wind-e9a3         │
│  GET /*                    geo proxy (used by GH Actions)       │
│  POST /api/trigger         GitHub Actions workflow_dispatch     │
│  POST /api/schedule        update n8n Schedule Trigger interval │
│  POST /api/workflow/activate|deactivate  n8n API                │
│  GET  /api/workflow/status               n8n API                │
│  POST /api/discord-test    Discord webhook test                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Service URLs

| Service | URL |
|---|---|
| Dashboard | https://gamerslab.space |
| Cloudflare Worker | https://geo-monitor-worker.divine-wind-e9a3.workers.dev |
| n8n instance | https://n8n-j39n.sliplane.app |
| n8n workflow | https://n8n-j39n.sliplane.app/workflow/pTkt5lTwDgTwUY1f |
| Supabase dashboard | https://supabase.com/dashboard/project/bacumktnpozarnfvsrbw |
| Supabase SQL editor | https://supabase.com/dashboard/project/bacumktnpozarnfvsrbw/sql |
| GitHub repo | https://github.com/DeveloperAlly/gamerslab |
| GitHub Actions | https://github.com/DeveloperAlly/gamerslab/actions/workflows/monitor.yml |
| Target game | https://uprisinglabs.itch.io/bug-seek-expedition-edition |
| Discord channel | #gamers-lab-monitor (guild 1066890817425387581, channel 1514424075282550916) |

---

## Secrets Reference

### GitHub Actions Secrets
_Settings → Secrets and variables → Actions_

| Secret | Value |
|---|---|
| `SUPABASE_URL` | `https://bacumktnpozarnfvsrbw.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (write access) |
| `TARGET_URL` | Fallback target URL (runner also reads live from Supabase) |

### Cloudflare Worker Secrets
_Set once via Cloudflare dashboard — persist across deploys_

| Secret | Purpose |
|---|---|
| `GITHUB_PAT` | PAT with `repo` + `actions:write` scope |
| `TARGET_URL` | Current monitoring target |
| `DISCORD_WEBHOOK_URL` | Discord webhook for /api/discord-test |
| `N8N_API_KEY` | n8n API key for workflow control endpoints |

### Cloudflare Worker Vars
_In `cloudflare/wrangler.toml` — safe to commit_

| Var | Value |
|---|---|
| `GITHUB_REPO_OWNER` | `DeveloperAlly` |
| `GITHUB_REPO_NAME` | `gamerslab` |

---

## Test Scripts

All scripts in `testing/scripts/`. Node 20+ only, zero npm dependencies (use native `fetch`).

### Setup

```bash
cd testing/scripts
cp .env.example .env
# Fill in SUPABASE_KEY, N8N_API_KEY, GITHUB_TOKEN
export $(grep -v '^#' .env | xargs)
```

### Run individual scripts

```bash
# Verify schema, seed data, recent results
node test-supabase.js

# Test Cloudflare Worker endpoints (non-destructive)
node test-worker.js --skip-trigger --skip-discord

# Check n8n workflow active, node config, recent executions
node test-n8n.js

# Verify GitHub Actions workflow and recent runs
node test-github-actions.js

# Full end-to-end: trigger → wait → verify Supabase
node test-e2e.js
node test-e2e.js --skip-trigger   # if a run is already in progress
```

### Run all non-destructive tests

```bash
npm run test:all
# or manually:
node test-supabase.js && \
node test-worker.js --skip-trigger --skip-discord && \
node test-n8n.js && \
node test-github-actions.js
```

---

## SQL Queries

In `testing/supabase/`. Paste into: https://supabase.com/dashboard/project/bacumktnpozarnfvsrbw/sql

| File | Purpose |
|---|---|
| `01_schema_migration.sql` | Create all tables, indexes, RLS off, seed data. Run once on fresh install or after schema changes. |
| `02_verification_queries.sql` | 12 individual queries to verify every layer — schema, recent results, uptime, Playwright health, referrers, surges, dead pipeline, JS errors. |

---

## Manual Test Checklists

### First-time setup
- [ ] Run `01_schema_migration.sql` in Supabase SQL editor
- [ ] Confirm 6 tables exist: `monitor_results`, `targets`, `referrers`, `monitor_config`, `trigger_log`, `scheduled_surges`
- [ ] Confirm `click_check_percentage=30` in `monitor_config`
- [ ] Confirm active target in `targets`
- [ ] Confirm 3 referrers in `referrers` (BugnSeek, Twitter/X, itch new+popular)
- [ ] Confirm GitHub Actions secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `TARGET_URL`
- [ ] Confirm Worker secrets: `GITHUB_PAT`, `TARGET_URL`, `DISCORD_WEBHOOK_URL`, `N8N_API_KEY`
- [ ] Confirm n8n Workflow A is **Active**

### Standard run
1. Dashboard → Control → **Run now**
2. GitHub Actions — confirm 6 jobs appear, each ~60–90s
3. Supabase SQL: run query 2 from `02_verification_queries.sql`
4. Confirm 6 new rows with `page_title` populated and `game_iframe_loaded` true/false
5. Dashboard Monitor tab — new rows appear in live feed
6. Expand a live feed row — check page title, iframe status, JS errors, referrer used

### Surge test
1. Dashboard → Control → **Trigger surge**
2. GitHub Actions — 6 jobs, each runs `surge.js` (19 extra concurrent visits)
3. Supabase: `select count(*) from monitor_results where mode='surge' and checked_at > now() - interval '1 hour'`
4. Dashboard — surge rows show amber badges in live feed

### Scheduled surge (Workflow F + G)
1. Dashboard → Control → Surge Event Scheduler → set time 2 minutes ahead → **Schedule surge**
2. Confirm Discord: 📅 Surge event scheduled
3. Supabase: `select status from scheduled_surges order by created_at desc limit 1` — should be `pending`
4. Wait 2 minutes (Workflow G polls every 1 minute)
5. Supabase: rerun — status should be `fired`, `fired_at` populated
6. Discord: ⚡ Scheduled surge fired
7. Cancel test: Dashboard cancel button PATCHes status=`cancelled` directly

### Click-check (Run game button)
1. Dashboard → Control → click-check slider → set to **100%** → Save
2. Confirm `monitor_config` updated: `select * from monitor_config where key='click_check_percentage'`
3. Trigger a standard run
4. Supabase: `select click_check_done, login_prompt_shown from monitor_results order by checked_at desc limit 6`
5. `click_check_done=true` for all 6 regions
6. `login_prompt_shown=true` means login prompt appeared (game embed live ✓)
7. `login_prompt_shown=false` means no prompt — investigate itch.io UI change
8. Dashboard live feed — rows show 🖱 login ✓ or 🖱 login ✗ inline, expandable detail
9. **Reset slider to 30%** after testing

### Referrer simulation
1. Dashboard → Control → Referrer Simulation — confirm BugnSeek, Twitter/X, itch new+popular
2. Trigger a standard run
3. Supabase: `select referrer_used, count(*) from monitor_results where checked_at > now() - interval '1 hour' group by referrer_used`
4. Should see one of the enabled referrer URLs in results
5. Toggle a referrer off → run again → confirm it no longer appears in `referrer_used`
6. Add a custom referrer → run → confirm it appears

### Discord alerts
1. Dashboard → Control → **Send test message to Discord** → confirm in #gamers-lab-monitor
2. Wait for a Workflow C 30-min report — format should be:
   ```
   ✅ GamersLab Monitor — 30 min report
   29/29 checks passed · avg 192ms · last run 03:30 pm · 5 surge runs
   🟢 us-east — 100% · 206ms
   🟢 eu-west — 100% · 213ms
   ...
   ```
3. To test dead-pipeline alert: pause Workflow A → wait 30min → expect 💀 alert

### n8n Workflow A error handling
1. In n8n, temporarily break the GitHub PAT credential
2. Wait for a Schedule Trigger tick (up to ~5 min, 30% gate)
3. Discord should receive: ❌ ERROR IN WORKFLOW A — CHECK N8N & GITHUB
4. Restore credential — errors should stop

### Workflow G — scheduled surge firing
1. Confirm Workflow G is active in n8n
2. Confirm **Mark fired** SQL node query starts with `=UPDATE scheduled_surges...` and uses `$('Check due events').item.json.id` (not `$json.id`)
3. `$json.id` is undefined after the GitHub dispatch node — this was a past bug that caused repeated n8n errors
4. Run `test-n8n.js` — it checks this automatically

---

## n8n Workflow Reference

All 7 workflows live in a single n8n workflow (ID `pTkt5lTwDgTwUY1f`) with separate trigger chains on the canvas.

| Workflow | Trigger | Purpose |
|---|---|---|
| A | Schedule (5min) + 30% gate | Random standard monitor dispatch |
| B | POST /webhook/surge | Immediate surge dispatch |
| C | Schedule (30min) | Stats digest + alerting to Discord |
| D | POST /webhook/update-target | Update monitored target URL |
| E | Schedule (2h) + 50% gate | Automated overnight surge tests |
| F | POST /webhook/schedule-surge | Accept and store a one-off scheduled surge |
| G | Schedule (1min) poll | Fire due scheduled surges, mark fired |

### n8n webhook URLs (production)
```
POST https://n8n-j39n.sliplane.app/webhook/surge
POST https://n8n-j39n.sliplane.app/webhook/update-target
POST https://n8n-j39n.sliplane.app/webhook/schedule-surge
```

---

## Known Behaviours

**GitHub Actions cron throttling** — GitHub throttles `*/5 * * * *` on free accounts; actual rate is 5–15 minutes. n8n Workflow A supplements this.

**`game_iframe_loaded=false` is a warning, not a hard failure** — Some Azure IP ranges are rate-limited by itch.io's CDN. The iframe check confirms the embed scaffold loaded; the game requiring WebGL to actually run is a separate concern.

**`login_prompt_shown=false`** — The click-check depends on itch.io's current UI. If itch.io changes the "Run game" flow (e.g. adds a cookie gate), the button may not behave as expected. Treat as a warning; investigate in GitHub Actions logs.

**SA East (Brazil) lower uptime** — Azure IPs in sa-east are throttled more aggressively by itch.io than other regions. 40–80% uptime is expected; it does not indicate a game availability problem.

**Playwright vs itch.io analytics** — Headless Chromium from datacenter IPs may or may not be counted as views by itch.io (undocumented filter). The pipeline validates page availability and render correctness; whether itch counts the visit is secondary.

**Workflow G `Mark fired` node** — After the GitHub dispatch node runs, it returns no output items. The `Mark fired` SQL must use `$('Check due events').item.json.id` to reach back to the Postgres result. Using `$json.id` returns `undefined` and causes repeated n8n errors. The `test-n8n.js` script checks this automatically.
