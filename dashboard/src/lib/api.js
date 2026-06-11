// Supabase — all reads and writes go directly from the browser
const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Worker — only used for trigger (needs server-side GitHub PAT)
const WORKER_URL = import.meta.env.VITE_WORKER_URL

function sbFetch(path, opts = {}) {
  return fetch(`${SB_URL}${path}`, {
    method: opts.method || 'GET',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(opts.headers || {}),
    },
    body: opts.body,
  }).then(async res => {
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Supabase error ${res.status}: ${text}`)
    }
    return res.json()
  })
}

async function workerFetch(path, opts = {}) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Worker error ${res.status}: ${text}`)
  }
  return res.json()
}

export const api = {
  // ── reads — direct Supabase ──────────────────────────────────────────────
  results(hours = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()
    return sbFetch(
      `/rest/v1/monitor_results?select=region,status,ttfb_ms,cf_colo,mode,checked_at&checked_at=gte.${since}&order=checked_at.desc&limit=2000`
    )
  },

  status() {
    return sbFetch(
      `/rest/v1/monitor_results?select=region,status,ttfb_ms,cf_colo,checked_at&order=checked_at.desc&limit=60`
    ).then(rows => {
      const byRegion = {}
      for (const r of rows) {
        if (!byRegion[r.region]) byRegion[r.region] = r
      }
      return Object.values(byRegion)
    })
  },

  activeTarget() {
    return sbFetch(
      `/rest/v1/targets?active=eq.true&order=set_at.desc&limit=1`
    ).then(rows => rows[0] || null)
  },

  targets() {
    return sbFetch(
      `/rest/v1/targets?select=id,url,name,set_at,active&order=set_at.desc&limit=20`
    )
  },

  // ── writes — direct Supabase ─────────────────────────────────────────────
  async setTarget(url, name) {
    // deactivate existing
    await sbFetch(`/rest/v1/targets?active=eq.true`, {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {})
    // insert new active target
    return sbFetch(`/rest/v1/targets`, {
      method: 'POST',
      body: JSON.stringify({ url, name: name || url, set_at: new Date().toISOString(), active: true }),
      headers: { Prefer: 'return=representation' },
    })
  },

  // ── trigger — Worker only (GitHub PAT stays server-side) ─────────────────
  trigger(mode, regions) {
    return workerFetch('/api/trigger', {
      body: JSON.stringify({ mode, regions }),
    })
  },

  // ── discord test — Worker (webhook URL stays server-side) ────────────────
  testDiscord() {
    return workerFetch('/api/discord-test')
  },
}
