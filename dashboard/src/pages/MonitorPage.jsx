import { useState, useEffect, useCallback } from 'react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api } from '../lib/api'

const REGIONS = ['us-east','eu-west','ap-southeast','sa-east','me-south','af-south']
const FLAGS = { 'us-east':'🇺🇸','eu-west':'🇪🇺','ap-southeast':'🇸🇬','sa-east':'🇧🇷','me-south':'🇸🇦','af-south':'🇰🇪' }
const REGION_NAMES = { 'us-east':'US East','eu-west':'EU West','ap-southeast':'AP Southeast','sa-east':'SA East','me-south':'ME South','af-south':'AF South' }
const HOURS_OPTS = [{ label: '1h', v: 1 }, { label: '24h', v: 24 }, { label: '7d', v: 168 }, { label: '30d', v: 720 }]

function Spinner() {
  return <div style={{ width: 14, height: 14, border: '1.5px solid var(--b2)', borderTopColor: 'var(--acc)', borderRadius: '50%', animation: 'spin .7s linear infinite', flexShrink: 0 }} />
}

function StatCard({ label, value, sub, color, pulse }) {
  return (
    <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b2)', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: 'var(--mono)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 500, color: color || 'var(--tx)', lineHeight: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
        {pulse && <div style={{ width: 7, height: 7, borderRadius: '50%', background: color || 'var(--acc)', animation: 'pulse 2s infinite', flexShrink: 0 }} />}
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--mu)', fontFamily: 'var(--mono)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function StatusDot({ ok, fail, total }) {
  if (!total) return <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--hi)', flexShrink: 0 }} />
  if (fail === 0) return <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', animation: 'pulse 3s infinite', flexShrink: 0 }} />
  if (ok === 0) return <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--red)', flexShrink: 0 }} />
  return <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--amber)', flexShrink: 0 }} />
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--s2)', border: '0.5px solid var(--b3)', borderRadius: 6, padding: '8px 10px', fontSize: 11 }}>
      <div style={{ color: 'var(--mu)', marginBottom: 4, fontFamily: 'var(--mono)' }}>{label}</div>
      {payload.map(p => <div key={p.name} style={{ color: p.color, fontFamily: 'var(--mono)' }}>{p.name}: {p.value}</div>)}
    </div>
  )
}

export default function MonitorPage() {
  const [hours, setHours] = useState(24)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [error, setError] = useState(null)
  const [expandedRow, setExpandedRow] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.results(hours)
      setRows(Array.isArray(data) ? data : [])
      setLastUpdated(new Date())
    } catch (e) { setError(e.message); console.error(e) }
    setLoading(false)
  }, [hours])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

  const total = rows.length
  const ok = rows.filter(r => r.status === 1).length
  const failed = total - ok
  const uptime = total ? +(ok / total * 100).toFixed(1) : 0
  const ttfbs = rows.filter(r => r.ttfb_ms).map(r => r.ttfb_ms)
  const avgTtfb = ttfbs.length ? Math.round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length) : 0
  const p95Ttfb = ttfbs.length ? Math.round([...ttfbs].sort((a,b)=>a-b)[Math.floor(ttfbs.length * 0.95)]) : 0
  const surgeRuns = rows.filter(r => r.mode === 'surge').length
  const hoursLabel = hours < 24 ? `${hours}h` : hours === 168 ? '7d' : hours === 720 ? '30d' : '24h'

  // Playwright health stats
  const playwrightRows = rows.filter(r => r.page_title !== undefined && r.page_title !== null)
  const iframeFailures = playwrightRows.filter(r => r.game_iframe_loaded === false && r.status === 1).length
  const jsErrorRows = playwrightRows.filter(r => {
    try { return JSON.parse(r.js_errors || '[]').length > 0 } catch { return false }
  }).length

  const bucketMs = hours <= 1 ? 5*60*1000 : hours <= 6 ? 15*60*1000 : hours <= 24 ? 3600*1000 : 6*3600*1000
  const buckets = {}
  rows.forEach(r => {
    const t = Math.floor(new Date(r.checked_at).getTime() / bucketMs) * bucketMs
    if (!buckets[t]) buckets[t] = { ok: 0, fail: 0, ttfb: [] }
    r.status === 1 ? buckets[t].ok++ : buckets[t].fail++
    if (r.ttfb_ms) buckets[t].ttfb.push(r.ttfb_ms)
  })
  const timelineData = Object.keys(buckets).map(Number).sort().map(t => ({
    time: hours <= 24 ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    ok: buckets[t].ok, fail: buckets[t].fail,
    avgTtfb: buckets[t].ttfb.length ? Math.round(buckets[t].ttfb.reduce((a,b)=>a+b,0)/buckets[t].ttfb.length) : 0,
  }))

  const byRegion = {}
  rows.forEach(r => {
    if (!byRegion[r.region]) byRegion[r.region] = { ok: 0, fail: 0, ttfbs: [], colos: new Set(), ips: new Set() }
    r.status === 1 ? byRegion[r.region].ok++ : byRegion[r.region].fail++
    if (r.ttfb_ms) byRegion[r.region].ttfbs.push(r.ttfb_ms)
    if (r.cf_colo) byRegion[r.region].colos.add(r.cf_colo)
    if (r.runner_ip) byRegion[r.region].ips.add(r.runner_ip)
  })
  const regionData = REGIONS.map(reg => {
    const d = byRegion[reg]
    if (!d) return { reg, ok: 0, fail: 0, total: 0, avgT: 0, uptime: 0, colos: '', ips: '' }
    const tot = d.ok + d.fail
    const avgT = d.ttfbs.length ? Math.round(d.ttfbs.reduce((a,b)=>a+b,0)/d.ttfbs.length) : 0
    return { reg, ok: d.ok, fail: d.fail, total: tot, avgT, uptime: tot ? Math.round(d.ok/tot*100) : 0, colos: [...d.colos].join(', '), ips: [...d.ips].slice(0,3).join(', ') }
  })

  const feed = rows.slice(0, 50)
  const allIps = [...new Set(rows.filter(r => r.runner_ip).map(r => r.runner_ip))]

  if (error) return (
    <div style={{ padding: 24, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 12 }}>
      Error: {error} <button onClick={load} style={{ marginTop: 8, fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '0.5px solid var(--red)', background: 'transparent', color: 'var(--red)', cursor: 'pointer', marginLeft: 8 }}>retry</button>
    </div>
  )

  return (
    <div style={{ padding: 16, animation: 'fadeIn .2s ease', overflowX: 'hidden' }}>

      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 3, background: 'var(--s1)', border: '0.5px solid var(--b2)', borderRadius: 6, padding: 3 }}>
          {HOURS_OPTS.map(o => (
            <button key={o.v} onClick={() => setHours(o.v)} style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 4, border: 'none',
              background: hours === o.v ? 'var(--acc)' : 'transparent',
              color: hours === o.v ? '#000' : 'var(--mu)',
              fontWeight: hours === o.v ? 500 : 400, transition: 'all .15s',
            }}>{o.label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {loading && <Spinner />}
        {lastUpdated && !loading && <div style={{ fontSize: 10, color: 'var(--hi)', fontFamily: 'var(--mono)' }}>{lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
        <button onClick={load} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '0.5px solid var(--b2)', background: 'transparent', color: 'var(--mu)' }}>↻</button>
      </div>

      {/* stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
        <StatCard label="monitor checks" value={total.toLocaleString()} sub={`last ${hoursLabel} · browser visits`} />
        <StatCard label="uptime" value={`${uptime}%`} sub={`${ok.toLocaleString()} ok · ${failed} failed`}
          color={uptime === 100 ? 'var(--green)' : uptime >= 95 ? 'var(--amber)' : 'var(--red)'} pulse={uptime === 100} />
        <StatCard label="avg ttfb" value={`${avgTtfb}ms`} sub={`p95 ${p95Ttfb}ms`}
          color={avgTtfb < 200 ? 'var(--green)' : avgTtfb < 500 ? 'var(--amber)' : 'var(--red)'} />
        <StatCard label="surge runs" value={surgeRuns} sub="campaign tests" />
      </div>

      {/* Playwright health banner — only shown when playwright data exists */}
      {playwrightRows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
          <div style={{ background: 'var(--s1)', border: `0.5px solid ${iframeFailures > 0 ? 'var(--amber)' : 'var(--b2)'}`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 16 }}>{iframeFailures > 0 ? '⚠️' : '✅'}</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500 }}>Game iframe</div>
              <div style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>
                {iframeFailures > 0 ? `${iframeFailures} check${iframeFailures > 1 ? 's' : ''} missing iframe` : 'loaded in all checks'}
              </div>
            </div>
          </div>
          <div style={{ background: 'var(--s1)', border: `0.5px solid ${jsErrorRows > 0 ? 'var(--red)' : 'var(--b2)'}`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 16 }}>{jsErrorRows > 0 ? '🚨' : '✅'}</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500 }}>JS errors</div>
              <div style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>
                {jsErrorRows > 0 ? `${jsErrorRows} check${jsErrorRows > 1 ? 's' : ''} had console errors` : 'no console errors detected'}
              </div>
            </div>
          </div>
          <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b2)', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 16 }}>🖥️</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500 }}>Playwright checks</div>
              <div style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>{playwrightRows.length} full browser visits</div>
            </div>
          </div>
        </div>
      )}

      {/* charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8 }}>
        <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b2)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 500 }}>monitor checks over time</div>
            <div style={{ display: 'flex', gap: 12 }}>
              {[['#00c97a','ok'],['#f03e3e','failed']].map(([c,l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--mu)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
                </div>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={timelineData} margin={{ top: 0, right: 0, bottom: 0, left: -28 }} barSize={timelineData.length > 24 ? 3 : 8}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'var(--mu)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: 'var(--mu)' }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="ok" stackId="a" fill="#00c97a" />
              <Bar dataKey="fail" stackId="a" fill="#f03e3e" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b2)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 12 }}>avg ttfb trend</div>
          <ResponsiveContainer width="100%" height={130}>
            <AreaChart data={timelineData} margin={{ top: 0, right: 0, bottom: 0, left: -28 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
              <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'var(--mu)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: 'var(--mu)' }} tickLine={false} axisLine={false} unit="ms" />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="avgTtfb" stroke="var(--acc)" fill="var(--acc-dim)" strokeWidth={1.5} dot={false} name="ttfb" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* regions + feed */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b2)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 10 }}>regions</div>
          <div style={{ display: 'grid', gridTemplateColumns: '16px 1fr 48px 52px 40px', gap: 6, marginBottom: 6, paddingBottom: 6, borderBottom: '0.5px solid var(--b1)' }}>
            {['','region','uptime','ttfb','pop'].map(h => (
              <div key={h} style={{ fontSize: 9, color: 'var(--hi)', textTransform: 'uppercase', letterSpacing: '.05em', textAlign: h !== '' && h !== 'region' ? 'right' : 'left' }}>{h}</div>
            ))}
          </div>
          {regionData.map(({ reg, ok, fail, total, avgT, uptime: ut, colos, ips }) => (
            <div key={reg} style={{ display: 'grid', gridTemplateColumns: '16px 1fr 48px 52px 40px', gap: 6, alignItems: 'center', padding: '7px 0', borderBottom: '0.5px solid var(--b1)' }}>
              <StatusDot ok={ok} fail={fail} total={total} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--tx)' }}>{FLAGS[reg]} {REGION_NAMES[reg]}</div>
                <div style={{ fontSize: 9, color: 'var(--mu)', fontFamily: 'var(--mono)', marginTop: 1 }}>{total} checks{ips ? ` · ${ips.split(',')[0].trim()}` : ''}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', color: ut === 100 ? 'var(--green)' : ut >= 95 ? 'var(--amber)' : total === 0 ? 'var(--hi)' : 'var(--red)' }}>
                {total ? `${ut}%` : '—'}
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', color: avgT < 200 ? 'var(--tx)' : avgT < 500 ? 'var(--amber)' : 'var(--red)' }}>
                {avgT ? `${avgT}ms` : '—'}
              </div>
              <div style={{ textAlign: 'right', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--mu)' }}>
                {colos || '—'}
              </div>
            </div>
          ))}
        </div>

        {/* live feed — now shows Playwright details on expand */}
        <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b2)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 500 }}>live feed</div>
            {loading && <Spinner />}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: 320 }}>
            {feed.length === 0 && <div style={{ color: 'var(--mu)', fontSize: 12, textAlign: 'center', padding: '2rem 0', fontFamily: 'var(--mono)' }}>no data in this range</div>}
            {feed.map((r, i) => {
              const isOk = r.status === 1
              const isSurge = r.mode === 'surge'
              const hasPlaywright = r.page_title !== null && r.page_title !== undefined
              const jsErrors = (() => { try { return JSON.parse(r.js_errors || '[]') } catch { return [] } })()
              const hasJsErrors = jsErrors.length > 0
              const iframeOk = r.game_iframe_loaded
              const isExpanded = expandedRow === i

              const badgeText = isSurge ? 'surge' : isOk ? 'ok' : 'fail'
              const badgeColor = isSurge ? 'var(--amber)' : isOk ? 'var(--green)' : 'var(--red)'
              const badgeBg = isSurge ? 'var(--amber-dim)' : isOk ? 'var(--green-dim)' : 'var(--red-dim)'

              return (
                <div key={i} style={{ borderBottom: '0.5px solid var(--b1)' }}>
                  <div
                    onClick={() => hasPlaywright && setExpandedRow(isExpanded ? null : i)}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 0', cursor: hasPlaywright ? 'pointer' : 'default' }}
                  >
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--hi)', flexShrink: 0, width: 38 }}>
                      {new Date(r.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 3, background: badgeBg, color: badgeColor, flexShrink: 0, fontFamily: 'var(--mono)' }}>{badgeText}</span>
                    <div style={{ fontSize: 10, color: 'var(--tx)', flex: 1, overflow: 'hidden' }}>
                      <span style={{ fontWeight: 500 }}>{FLAGS[r.region]} {r.region}</span>
                      {isOk && r.ttfb_ms && <span style={{ color: 'var(--mu)' }}> · {Math.round(r.ttfb_ms)}ms</span>}
                      {r.cf_colo && <span style={{ color: 'var(--mu)' }}> · {r.cf_colo}</span>}
                      {!isOk && r.render_error && <span style={{ color: 'var(--red)' }}> · {r.render_error}</span>}
                      {!isOk && !r.render_error && <span style={{ color: 'var(--red)' }}> · failed</span>}
                      {/* Playwright inline indicators */}
                      {hasPlaywright && hasJsErrors && <span style={{ color: 'var(--red)', fontSize: 9 }}> · {jsErrors.length} JS err</span>}
                      {hasPlaywright && !iframeOk && isOk && <span style={{ color: 'var(--amber)', fontSize: 9 }}> · no iframe</span>}
                    </div>
                    {hasPlaywright && <div style={{ fontSize: 9, color: 'var(--hi)', flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</div>}
                  </div>

                  {/* Expanded Playwright detail */}
                  {isExpanded && hasPlaywright && (
                    <div style={{ padding: '6px 8px 8px 45px', background: 'var(--s2)', borderRadius: 5, marginBottom: 4, fontSize: 10, fontFamily: 'var(--mono)' }}>
                      {r.page_title && <div style={{ color: 'var(--mu)', marginBottom: 3 }}>title: <span style={{ color: 'var(--tx)' }}>{r.page_title}</span></div>}
                      <div style={{ color: 'var(--mu)', marginBottom: 3 }}>
                        iframe: <span style={{ color: iframeOk ? 'var(--green)' : 'var(--amber)' }}>{iframeOk ? '✓ loaded' : '✗ not found'}</span>
                      </div>
                      <div style={{ color: 'var(--mu)', marginBottom: 3 }}>
                        js errors: <span style={{ color: hasJsErrors ? 'var(--red)' : 'var(--green)' }}>{hasJsErrors ? jsErrors.length : '0'}</span>
                      </div>
                      {hasJsErrors && jsErrors.slice(0, 3).map((e, j) => (
                        <div key={j} style={{ color: 'var(--red)', fontSize: 9, marginLeft: 8, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e}
                        </div>
                      ))}
                      {r.page_blocked && <div style={{ color: 'var(--red)' }}>⚠ page blocked by Cloudflare</div>}
                      {r.render_error && <div style={{ color: 'var(--red)', marginTop: 2 }}>error: {r.render_error}</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {allIps.length > 0 && (
        <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b2)', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 10 }}>runner IPs this window <span style={{ fontSize: 10, color: 'var(--mu)', fontWeight: 400 }}>— egress IPs used to reach itch.io</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allIps.map(ip => (
              <span key={ip} style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'var(--s2)', border: '0.5px solid var(--b2)', color: 'var(--tx)' }}>{ip}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
