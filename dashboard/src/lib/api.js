const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const WORKER_URL = import.meta.env.VITE_WORKER_URL
const N8N_URL = 'https://n8n-j39n.sliplane.app'

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SB_URL}${path}`, {
    method: opts.method || 'GET',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase ${res.status}: ${text}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : []
}

async function workerFetch(path, opts = {}) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Worker ${res.status}: ${text}`)
  }
  return res.json()
}

export const api = {
  // ── Supabase reads ────────────────────────────────────────────────────────
  // Now includes Playwright fields: page_title, game_iframe_loaded, js_errors, page_blocked, render_error
  results(hours = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()
    return sbFetch(
      `/rest/v1/monitor_results?select=region,status,ttfb_ms,cf_colo,runner_ip,mode,checked_at,page_title,game_iframe_loaded,js_errors,page_blocked,render_error` +
      `&checked_at=gte.${since}&order=checked_at.desc&limit=2000`
    )
  },

  activeTarget() {
    return sbFetch(`/rest/v1/targets?active=eq.true&order=set_at.desc&limit=1`)
      .then(rows => rows[0] || null)
  },

  targets() {
    return sbFetch(`/rest/v1/targets?select=id,url,name,set_at,active&order=set_at.desc&limit=20`)
  },

  scheduledSurges() {
    return sbFetch(`/rest/v1/scheduled_surges?select=id,scheduled_at,label,status,fired_at&status=eq.pending&order=scheduled_at.asc&limit=15`)
  },

  cancelSurge(id) {
    return sbFetch(`/rest/v1/scheduled_surges?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled' }),
      headers: { Prefer: 'return=minimal' },
    })
  },

  // ── Supabase writes ───────────────────────────────────────────────────────
  async setTarget(url, name) {
    await sbFetch(`/rest/v1/targets?active=eq.true`, {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {})
    return sbFetch(`/rest/v1/targets`, {
      method: 'POST',
      body: JSON.stringify({ url, name: name || url, set_at: new Date().toISOString(), active: true }),
      headers: { Prefer: 'return=minimal' },
    })
  },

  // ── Worker — GitHub Actions trigger ──────────────────────────────────────
  trigger(mode, regions) {
    return workerFetch('/api/trigger', { body: { mode, regions } })
  },

  // ── Worker — n8n schedule control ────────────────────────────────────────
  getWorkflowStatus() {
    return workerFetch('/api/workflow/status', { method: 'GET' })
  },

  setSchedule(intervalMinutes) {
    return workerFetch('/api/schedule', { body: { intervalMinutes } })
  },

  activateWorkflow() {
    return workerFetch('/api/workflow/activate', { body: {} })
  },

  deactivateWorkflow() {
    return workerFetch('/api/workflow/deactivate', { body: {} })
  },

  // ── n8n webhook — schedule one-off surge ─────────────────────────────────
  scheduleSurge(scheduledAt, label) {
    return fetch(`${N8N_URL}/webhook/schedule-surge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt, label }),
    }).then(async res => {
      if (!res.ok) throw new Error(`Schedule failed: ${await res.text()}`)
      return res.json()
    })
  },

  // ── Worker — Discord test ─────────────────────────────────────────────────
  testDiscord() {
    return workerFetch('/api/discord-test', { body: {} })
  },
}
