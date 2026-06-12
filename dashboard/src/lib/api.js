const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const WORKER_URL = import.meta.env.VITE_WORKER_URL

// ── Supabase paginated GET ────────────────────────────────────────────────────
// Supabase REST API silently caps at 1000 rows per request regardless of ?limit=
// This fetches all pages and concatenates results.
async function sbGetAll(path) {
  const PAGE = 1000
  let offset = 0
  let all = []
  while (true) {
    const res = await fetch(`${SB_URL}${path}`, {
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        'Range-Unit': 'items',
        Range: `${offset}-${offset + PAGE - 1}`,
      },
    })
    // 416 = Range Not Satisfiable = no more rows
    if (res.status === 416) break
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Supabase ${res.status}: ${text}`)
    }
    const text = await res.text()
    const rows = text ? JSON.parse(text) : []
    all = all.concat(rows)
    if (rows.length < PAGE) break  // last page
    offset += PAGE
  }
  return all
}

// ── Supabase single-result or write fetch ─────────────────────────────────────
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
  // ── Monitor results (windowed, for charts + live feed) ────────────────────
  // Paginates automatically — returns ALL rows in the time window, no cap
  results(hours = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()
    return sbGetAll(
      `/rest/v1/monitor_results?select=region,status,ttfb_ms,cf_colo,runner_ip,mode,checked_at,` +
      `page_title,game_iframe_loaded,js_errors,page_blocked,render_error,referrer_used,click_check_done,login_prompt_shown` +
      `&checked_at=gte.${since}&order=checked_at.desc`
    )
  },

  // ── All-time aggregate stats (for top stat cards) ─────────────────────────
  // Uses count=exact — returns real totals without fetching any rows
  async allTimeStats() {
    const [totalRes, okRes, surgeRes] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/monitor_results?select=id`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' }
      }),
      fetch(`${SB_URL}/rest/v1/monitor_results?select=id&status=eq.1`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' }
      }),
      fetch(`${SB_URL}/rest/v1/monitor_results?select=id&mode=eq.surge`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' }
      }),
    ])

    const parseCount = res => {
      const range = res.headers.get('Content-Range')
      if (range) {
        const match = range.match(/\/(\d+)$/)
        if (match) return parseInt(match[1])
      }
      return 0
    }

    const total = parseCount(totalRes)
    const ok = parseCount(okRes)
    const surgeTotal = parseCount(surgeRes)

    return { total, ok, failed: total - ok, surgeTotal }
  },

  // ── Targets ──────────────────────────────────────────────────────────────────
  activeTarget() {
    return sbFetch(`/rest/v1/targets?active=eq.true&order=set_at.desc&limit=1`)
      .then(rows => rows[0] || null)
  },

  targets() {
    return sbFetch(`/rest/v1/targets?select=id,url,name,set_at,active&order=set_at.desc&limit=20`)
  },

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

  // ── Referrers ──────────────────────────────────────────────────────────────
  referrers() {
    return sbFetch(`/rest/v1/referrers?select=id,url,name,enabled&order=created_at.asc`)
      .then(rows => {
        const seen = new Set()
        return rows.filter(r => {
          if (seen.has(r.url)) return false
          seen.add(r.url)
          return true
        })
      })
  },

  addReferrer(url, name) {
    return sbFetch(`/rest/v1/referrers`, {
      method: 'POST',
      body: JSON.stringify({ url, name: name || url, enabled: true }),
      headers: { Prefer: 'return=representation' },
    })
  },

  toggleReferrer(id, enabled) {
    return sbFetch(`/rest/v1/referrers?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
      headers: { Prefer: 'return=minimal' },
    })
  },

  deleteReferrer(id) {
    return sbFetch(`/rest/v1/referrers?id=eq.${id}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    })
  },

  // ── Monitor config ─────────────────────────────────────────────────────────
  getConfig() {
    return sbFetch(`/rest/v1/monitor_config?select=key,value`)
      .then(rows => {
        const map = {}
        rows.forEach(r => { map[r.key] = r.value })
        return map
      })
      .catch(() => ({}))
  },

  setConfig(key, value) {
    return sbFetch(`/rest/v1/monitor_config`, {
      method: 'POST',
      body: JSON.stringify({ key, value: String(value), updated_at: new Date().toISOString() }),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    })
  },

  // ── Scheduled surges ─────────────────────────────────────────────────────────
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

  // Routes through Cloudflare Worker to avoid CORS — n8n does not send CORS headers
  scheduleSurge(scheduledAt, label) {
    return workerFetch('/api/schedule-surge', { body: { scheduledAt, label } })
  },

  // ── Worker — triggers + n8n control ─────────────────────────────────────────
  trigger(mode, regions) {
    return workerFetch('/api/trigger', { body: { mode, regions } })
  },

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

  testDiscord() {
    return workerFetch('/api/discord-test', { body: {} })
  },
}
