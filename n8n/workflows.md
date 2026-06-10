
## Workflow A

Schedule Trigger (every 5 min)
  → Code node: Math.random() < 0.3 ? continue : stop   ← ~30% fire rate
  → HTTP Request: POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/monitor.yml/dispatches
    Body: { "ref": "main", "inputs": { "mode": "standard" } }
    Headers: Authorization: Bearer {{ $env.GITHUB_PAT }}


## Workflow B

Webhook Trigger: POST /webhook/surge
  → HTTP Request: POST GitHub dispatch
    Body: { "ref": "main", "inputs": { "mode": "surge", "regions": "us-east,eu-west,ap-southeast,sa-east" } }

## Workflow C

Schedule Trigger
  → Supabase node: SELECT * FROM monitor_results WHERE checked_at > now() - interval '30 min' AND status = 0
  → IF: rows > 0
    → Slack / email: "{{ $json.region }} failing — TTFB {{ $json.ttfb_ms }}ms"


