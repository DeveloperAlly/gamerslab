# GamersLab Geo Monitor — n8n Workflows

All 7 workflows live in a single n8n instance at `https://n8n-j39n.sliplane.app`. Because n8n can only import one workflow at a time, each workflow has its own JSON file here for individual import.

**n8n instance:** `https://n8n-j39n.sliplane.app`  
**GitHub repo:** `DeveloperAlly/gamerslab`  
**GitHub Actions workflow numeric ID:** `292793083` (Geo Monitor)  
**Supabase project:** `bacumktnpozarnfvsrbw`  
**Discord channel:** `#gamers-lab-monitor` (`1514424075282550916`)

---

## Architecture overview

```
n8n (Workflows A–G)
  ├── A: Scheduled random dispatch  ──┐
  ├── B: Manual surge webhook       ──┤──► GitHub Actions (geo-monitor)
  ├── E: Automated surge schedule   ──┤       └── 6 parallel runners
  └── G: Scheduled one-off surges   ──┘              └── Cloudflare Worker
                                                            └── Target URL (itch.io)
                                                                 └── Supabase (monitor_results)
  ├── C: 30-min stats digest ◄── Postgres ──► Discord
  ├── D: Target URL sync     ◄── Webhook  ──► Supabase (targets)
  └── F: Schedule surge event ◄── Webhook ──► Supabase (scheduled_surges)
```

---

## Workflows

### Workflow A — Scheduled Monitor
**File:** `workflowA.json`  
**Trigger:** Schedule Trigger every 5 minutes  
**Purpose:** Randomly dispatches the Geo Monitor GitHub Action on ~30% of ticks (roughly once every 15 minutes on average). Creates natural variation to avoid predictable bot-like patterns.

**Flow:** Schedule Trigger → Random gate (30% pass) → GitHub Dispatch (standard mode) → [onError] Discord error alert

**Nodes:**
- `Schedule Trigger` — fires every 5 min (adjustable via dashboard Control page)
- `Random gate` — Code node, `Math.random() > 0.3` returns empty to skip
- `Dispatch a workflow event` — GitHub node, Workflow Dispatch, Geo Monitor, `{ "mode": "standard" }`, credential: GitHub GamersLab, `onError: continueRegularOutput`
- `Send Error Message` — Discord Bot, posts error to #gamers-lab-monitor

**Dashboard:** Toggle on Control page activates/deactivates this workflow via n8n API. Interval selector saves new minutesInterval to the Schedule Trigger node.

---

### Workflow B — Campaign Surge Webhook
**File:** `workflowB.json`  
**Trigger:** `POST /webhook/surge`  
**Purpose:** Immediately dispatches a 20-concurrent-requests-per-region surge test. Used by the dashboard Trigger surge button.

**Flow:** Webhook → GitHub Dispatch (surge mode) → Respond `{ triggered: true }`

**Nodes:**
- `Surge webhook` — POST path: `surge`, webhookId: `surge`
- `Dispatch a workflow event1` — GitHub node, `{ "mode": "surge" }`, credential: GitHub GamersLab
- `Respond` — respondToWebhook, `{ triggered: true }`

**Direct call:** `POST https://n8n-j39n.sliplane.app/webhook/surge`  
**Dashboard path:** Control → Trigger surge → Worker `/api/trigger` → GitHub Actions

---

### Workflow C — Stats + Alerting (Discord)
**File:** `workflowC.json`  
**Trigger:** Schedule Trigger every 30 minutes  
**Purpose:** Posts a full stats digest to Discord every 30 minutes regardless of status. Alerts on failures and dead pipeline.

**Flow:** Alert schedule → Check status (Postgres) → Evaluate status (Code) → Send alert (Discord)

**Nodes:**
- `Alert schedule1` — 30 min interval
- `Check status` — Postgres executeQuery, aggregates ok_count, failure_count, total_count, avg_ttfb, surge_count, per-region recent JSON from monitor_results in last 30 min
- `Evaluate status` — Code node builds Discord message with per-region breakdown
- `Send alert` — Discord Bot

**Discord message format:**
```
✅ GamersLab Monitor — 30 min report
62/66 checks passed · avg 147ms · last run 12:54 pm

🟢 us-east — 100% · 152ms
🟢 eu-west — 100% · 144ms
🟡 sa-east — 73% · 119ms
```

**Alert thresholds:** 💀 dead (total=0) · 🚨 critical (3+ failures) · ⚠️ warning (1–2 failures) · ✅ healthy

---

### Workflow D — Target URL Sync
**File:** `workflowD.json`  
**Trigger:** `POST /webhook/update-target`  
**Purpose:** Updates the monitored target URL, saves to Supabase targets table, notifies Discord.

**Flow:** Webhook → Validate URL (Code) → Save to Supabase (Postgres insert, targets table) → Notify Discord → Respond `{ updated: true }`

**Payload:** `{ "url": "https://example.itch.io/game", "name": "My Game" }`  
**Direct call:** `POST https://n8n-j39n.sliplane.app/webhook/update-target`

---

### Workflow E — Scheduled Surge Testing
**File:** `workflowE.json`  
**Trigger:** Schedule Trigger every 2 hours  
**Purpose:** Automatically fires surge tests overnight. 50% random gate = ~1 surge per 4 hours on average. Builds baseline surge data without manual intervention.

**Flow:** Surge schedule (2h) → Random surge gate (50%) → GitHub Dispatch (surge mode) → Notify Discord

**Use case:** Leave active overnight before a planned campaign launch.

---

### Workflow F — Scheduled One-Off Surge Events
**File:** `workflowF.json`  
**Trigger:** `POST /webhook/schedule-surge`  
**Purpose:** Accepts a specific future datetime for a surge test (up to 15 days ahead). Saves to scheduled_surges table. Workflow G executes it.

**Flow:** Webhook → Validate schedule (Code: checks ISO date, future, within 15 days) → Save surge event (Postgres insert, status=pending) → Confirm Discord → Respond `{ scheduled: true, scheduledAt, label, delayMinutes }`

**Payload:** `{ "scheduledAt": "2026-06-15T14:00:00+10:00", "label": "itch new release day" }`  
**Dashboard:** Control page → Surge Event Scheduler card → datetime picker + label → Schedule surge button

**Core use case:** Fire a surge test exactly when itch.io traffic is naturally high (new game release, Reddit post, influencer mention) to get real-world load test data.

---

### Workflow G — Execute Scheduled Surge Events
**File:** `workflowG.json`  
**Trigger:** Schedule Trigger every 1 minute  
**Purpose:** Polls scheduled_surges every minute, fires any due events, marks them fired, notifies Discord.

**Flow:** Poll schedule (1min) → Check due events (Postgres: pending rows due within 1min window) → Any due? (IF) → Fire surge (GitHub Dispatch) → Mark fired (UPDATE status=fired) → Notify Discord

**Supabase table:** `scheduled_surges` — id, scheduled_at, label, status (pending/fired/cancelled), fired_at, created_at  
**Cancellation:** Dashboard cancel → PATCH status=cancelled in Supabase → Workflow G ignores it automatically  
**Missed event recovery:** 5-min lookback window catches events missed due to n8n downtime

---

## Supabase tables

| Table | Purpose |
|---|---|
| `monitor_results` | Every check result: region, status, ttfb_ms, cf_colo, runner_ip, mode, checked_at |
| `targets` | Monitored URL history, active flag |
| `scheduled_surges` | One-off surge event queue |
| `trigger_log` | Manual trigger audit log |

RLS disabled on all tables. Dashboard reads with publishable key. GitHub Actions writes with service key.

---

## Credentials in n8n

| Name | Type | Used by |
|---|---|---|
| GitHub GamersLab | GitHub API | Workflows A, B, E, G dispatch nodes |
| Postgres GamersLab | Postgres | All Postgres nodes |
| Discord Bot GamersLab | Discord Bot | All Discord nodes |

---

## Importing a workflow

n8n can only import one workflow at a time. To import:
1. Open n8n → New workflow (or open existing)
2. Three-dot menu → Import from file (or paste JSON)
3. Select the relevant `workflowX.json` file
4. Save and activate

**Important:** After import, verify credentials are correctly assigned — n8n may show credential warnings if the IDs don't match your instance. Re-select from the dropdown in each node.
