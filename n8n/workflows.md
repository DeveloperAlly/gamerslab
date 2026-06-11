# GamersLab Geo Monitor — n8n Workflows

Seven workflows running on the self-hosted n8n instance at `https://n8n-j39n.sliplane.app`. All workflows live in a single n8n page (`n8n.json`) and are also exported individually as `workflowA.json` through `workflowG.json` for importing one at a time.

---

## Architecture overview

```
Workflows A/B/E/F/G  →  GitHub Actions (Geo Monitor)  →  Cloudflare Worker  →  target URL
                                    ↓
                              Supabase (monitor_results)
                                    ↑
Workflow C  ←  Supabase query  ←─────┘  →  Discord #gamers-lab-monitor
Workflow D  →  Supabase (targets)
Workflow F  →  Supabase (scheduled_surges)  →  Workflow G (poll + fire)
```

**GitHub Actions** runs the actual geo-distributed HTTP checks from 6 regions. n8n's role is scheduling, triggering, reporting, and alerting — not the checking itself.

---

## Importing into n8n

Each `workflowX.json` file is a single workflow object and can be imported directly:

1. Open n8n → **Workflows** → **+** → **Import from file**
2. Select the individual `workflowX.json` file
3. Repeat for each workflow
4. Do NOT import `n8n.json` directly — it is a combined reference file, not importable as-is

---

## Environment variables

Set in n8n under **Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `GITHUB_REPO_OWNER` | `DeveloperAlly` |
| `GITHUB_REPO_NAME` | `gamerslab` |

---

## Credentials required

Set up in n8n under **Settings → Credentials** before activating workflows:

| Credential name | Type | Used by |
|---|---|---|
| `GitHub GamersLab` | GitHub API | Workflows A, B, E, G — workflow dispatch |
| `Postgres GamersLab` | Postgres | Workflows C, D, F, G — Supabase direct connection |
| `Discord Bot GamersLab` | Discord Bot API | Workflows A (errors), C, D, E, F, G — #gamers-lab-monitor |

---

## Workflows

### Workflow A — Scheduled Monitor

**File:** `workflowA.json`  
**Trigger:** Schedule Trigger every 5 minutes  
**Activate:** Yes — primary background scheduler

Randomly dispatches the Geo Monitor GitHub Action approximately every 15 minutes on average. The 30% random gate (`Math.random() > 0.3`) skips most ticks to create natural variation that avoids predictable bot-like request patterns.

**Flow:**
```
Schedule Trigger (5min) → Random gate (30% pass) → Dispatch GitHub Action (standard mode)
                                                              ↓ [onError: continueRegularOutput]
                                                    Send Error Message (Discord)
```

If the GitHub dispatch fails for any reason (rate limit, auth issue, API error), the error flows to Discord instead of silently disappearing.

**Dashboard control:** The toggle on the Control page activates/deactivates this workflow via the n8n API. The interval selector updates the Schedule Trigger's `minutesInterval` parameter via a PUT to the n8n workflow API through the Cloudflare Worker.

**Note:** GitHub Actions also runs on its own cron (`*/5 * * * *`) as a primary fallback, so monitoring continues even if n8n is down.

---

### Workflow B — Campaign Surge Webhook

**File:** `workflowB.json`  
**Trigger:** POST /webhook/surge  
**Activate:** Yes — always listening

Immediately dispatches a surge test when called. Used by the dashboard "Trigger surge" button and callable externally during live campaigns.

**Flow:**
```
Webhook (POST /surge) → Dispatch GitHub Action (surge mode) → Respond { triggered: true }
```

**What surge mode does:** Each of the 6 GitHub Actions runners fires 20 concurrent background requests to the target URL (120 total). Tests whether the page stays available and responsive under high concurrent load — simulates a campaign traffic spike.

**Direct call:**
```bash
curl -X POST https://n8n-j39n.sliplane.app/webhook/surge
```

---

### Workflow C — Stats + Alerting (Discord)

**File:** `workflowC.json`  
**Trigger:** Schedule Trigger every 30 minutes  
**Activate:** Yes — always posting

Posts a full stats digest to Discord every 30 minutes regardless of pass/fail. Also handles dead-pipeline detection.

**Flow:**
```
Alert schedule (30min) → Check status (Postgres) → Build report (Code) → Send report (Discord)
```

**SQL query** aggregates from `monitor_results` for the last 30 minutes: `ok_count`, `failure_count`, `total_count`, `avg_ttfb`, `last_seen`, `surge_count`, and a JSON array of recent results for the per-region breakdown.

**Discord message format:**
```
✅ GamersLab Monitor — 30 min report
62/66 checks passed · avg 147ms · last run 12:54 pm

🟢 us-east — 100% · 152ms
🟢 eu-west — 100% · 144ms
🟢 ap-southeast — 100% · 168ms
🟡 sa-east — 73% · 119ms
🟡 me-south — 91% · 125ms
🟢 af-south — 100% · 175ms
```

**Alert levels:**
- 💀 `total = 0` → pipeline dead alert + GitHub Actions link
- 🚨 3+ failures → critical
- ⚠️ 1–2 failures → warning
- ✅ All passed → normal stats digest, no extra alert

---

### Workflow D — Target URL Sync

**File:** `workflowD.json`  
**Trigger:** POST /webhook/update-target  
**Activate:** Yes — always listening

Updates the monitored target URL. Saves to the `targets` table in Supabase and notifies Discord.

**Flow:**
```
Webhook (POST /update-target) → Validate URL (Code) → Save to Supabase → Notify Discord → Respond { updated: true }
```

**Supabase `targets` table:** Stores `url`, `name`, `set_at`, `active`. The dashboard reads the `active=true` row to show the current monitoring target. The Cloudflare Worker reads `TARGET_URL` from its own secrets (set separately) — updating the target here logs it but does not automatically update the Worker secret.

**Direct call:**
```bash
curl -X POST https://n8n-j39n.sliplane.app/webhook/update-target \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.itch.io/game", "name": "My Game"}'
```

---

### Workflow E — Scheduled Surge Testing

**File:** `workflowE.json`  
**Trigger:** Schedule Trigger every 2 hours  
**Activate:** Yes — background overnight surge testing

Automatically fires surge tests without manual intervention. The 50% random gate means roughly 1 actual surge every 4 hours on average, creating unpredictable timing that better simulates organic campaign spikes.

**Flow:**
```
Surge schedule (2h) → Random surge gate (50% pass) → Dispatch surge (GitHub Action) → Notify Discord
```

Discord posts to `#gamers-lab-monitor` every time a surge fires, so there's always a record of when automated testing happened.

**Use case:** Leave running overnight before a planned campaign launch to build up baseline surge data before the actual campaign hits.

---

### Workflow F — Scheduled One-Off Surge Events

**File:** `workflowF.json`  
**Trigger:** POST /webhook/schedule-surge  
**Activate:** Yes — always listening

Accepts a specific future date/time for a surge test (up to 15 days ahead), validates it, saves to `scheduled_surges` in Supabase, and confirms in Discord. Workflow G handles the actual execution.

**Flow:**
```
Webhook (POST /schedule-surge) → Validate schedule (Code) → Save surge event (Postgres) → Confirm Discord → Respond
```

**Validation rules:**
- `scheduledAt` must be a valid ISO 8601 datetime
- Must be in the future
- Must be within 15 days

**Payload:**
```json
{
  "scheduledAt": "2026-06-15T14:00:00+10:00",
  "label": "itch new release day"
}
```

**Response:**
```json
{
  "scheduled": true,
  "scheduledAt": "2026-06-15T04:00:00.000Z",
  "label": "itch new release day",
  "delayMinutes": 2880
}
```

**Use case:** Schedule a surge test to fire exactly when itch.io traffic is naturally high — new game release, Reddit post, influencer mention — to get real-world load test data at peak organic traffic.

---

### Workflow G — Execute Scheduled Surge Events

**File:** `workflowG.json`  
**Trigger:** Schedule Trigger every 1 minute  
**Activate:** Yes — always polling

Polls `scheduled_surges` every minute and fires any pending events that are due.

**Flow:**
```
Poll schedule (1min) → Check due events (Postgres) → Any due? (IF) → Fire surge (GitHub Action)
                                                                               ↓
                                                                       Mark fired (Postgres)
                                                                               ↓
                                                                       Notify Discord
```

**SQL query:**
```sql
SELECT id, scheduled_at, label FROM scheduled_surges
WHERE status = 'pending'
AND scheduled_at <= now() + interval '1 minute'
AND scheduled_at >= now() - interval '5 minutes'
ORDER BY scheduled_at ASC
LIMIT 5
```

The 5-minute lookback window (`>= now() - interval '5 minutes'`) catches events that were due but missed due to n8n downtime or a restart. Without this, a scheduled surge during a restart would be silently skipped forever.

**Cancellation:** The dashboard Cancel button PATCHes `status = 'cancelled'` directly in Supabase. Workflow G's query only selects `status = 'pending'`, so cancelled rows are automatically skipped.

**Supabase `scheduled_surges` table:**
```
id           bigserial primary key
scheduled_at timestamptz not null
label        text
status       text  -- pending | fired | cancelled
fired_at     timestamptz
created_at   timestamptz
```

---

## Supabase tables used

| Table | Used by | Purpose |
|---|---|---|
| `monitor_results` | GitHub Actions (write), Workflow C (read) | All geo check results |
| `targets` | Workflow D (write), Dashboard (read) | Current + historical monitored URLs |
| `scheduled_surges` | Workflow F (write), Workflow G (read/write) | One-off surge event queue |
| `trigger_log` | Optional | Manual trigger audit log |

---

## Webhook URLs

| Workflow | URL | Method |
|---|---|---|
| B — Manual surge | `https://n8n-j39n.sliplane.app/webhook/surge` | POST |
| D — Update target | `https://n8n-j39n.sliplane.app/webhook/update-target` | POST |
| F — Schedule surge | `https://n8n-j39n.sliplane.app/webhook/schedule-surge` | POST |
