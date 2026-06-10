# n8n workflows

All three workflows are exported in `n8n.json` as a JSON array and can be imported directly into n8n.

## Importing

1. Open your n8n instance
2. Go to **Workflows** → **Import from file**
3. Select `n8n/n8n.json`
4. Import each workflow one at a time (n8n import accepts one workflow object at a time — copy each array element into a separate import)

## Credentials required

Set these up in n8n before activating the workflows (**Settings → Credentials**):

| Credential name | Type | Notes |
|---|---|---|
| `GitHub PAT` | HTTP Header Auth | Header: `Authorization`, Value: `Bearer YOUR_PAT` — needs `repo` + `actions` scopes |
| `Supabase DB` | Postgres | Use Supabase direct connection string from Project Settings → Database |
| `Slack` | Slack API | OAuth bot token with `chat:write` scope |

## Environment variables

Set these in n8n (**Settings → Environment Variables** or via `.env` on self-hosted):

| Variable | Value |
|---|---|
| `GITHUB_REPO_OWNER` | Your GitHub username or org |
| `GITHUB_REPO_NAME` | `gamerslab` (or whatever you named the repo) |

## Workflows

### Workflow A — Scheduled monitor
Fires every 5 minutes with a ~30% random gate, dispatching a `standard` mode run to GitHub Actions.

### Workflow B — Campaign surge webhook
Exposes `POST /webhook/surge`. Call this before publishing a campaign to trigger a `surge` mode run across all six regions. Returns `{ "triggered": true }`.

```bash
curl -X POST https://your-n8n-instance.com/webhook/surge
```

### Workflow C — Failure alerting
Polls Supabase every 15 minutes. If any region has a failed check in the last 30 minutes, posts an alert to the configured Slack channel.
