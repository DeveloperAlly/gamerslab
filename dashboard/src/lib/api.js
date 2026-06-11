const BASE = import.meta.env.VITE_API_URL || 'https://geo-monitor-worker.workers.dev'

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json()
}

export const api = {
  results: (hours = 24) => apiFetch(`/api/results?hours=${hours}&limit=2000`),
  status: () => apiFetch('/api/status'),
  activeTarget: () => apiFetch('/api/active-target'),
  targets: () => apiFetch('/api/targets'),
  trigger: (mode, regions) => apiFetch('/api/trigger', { method: 'POST', body: JSON.stringify({ mode, regions }) }),
  setTarget: (url, name) => apiFetch('/api/target', { method: 'PUT', body: JSON.stringify({ url, name }) }),
  testDiscord: () => apiFetch('/api/discord-test', { method: 'POST' }),
}
