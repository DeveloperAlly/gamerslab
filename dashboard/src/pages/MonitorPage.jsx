import { useState, useEffect, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '../lib/api'

const REGIONS = ['us-east','eu-west','ap-southeast','sa-east','me-south','af-south']
const FLAGS = { 'us-east':'🇺🇸','eu-west':'🇪🇺','ap-southeast':'🇸🇬','sa-east':'🇧🇷','me-south':'🇸🇦','af-south':'🇰🇪' }
const HOURS_OPTS = [{ label: '1h', v: 1 }, { label: '24h', v: 24 }, { label: '7d', v: 168 }, { label: '30d', v: 720 }]

function MetricCard({ label, value, sub, color }) {
  return (
    <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b1)', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 500, color: color || 'var(--tx)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--hi)', marginTop: 4, fontFamily: 'var(--mono)' }}>{sub}</div>}
    </div>
  )
}

function Dot({ status }) {
  const color = status === 'ok' ? 'var(--green)' : status === 'partial' ? 'var(--amber)' : 'var(--hi)'
  return <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
}

function FeedBadge({ type }) {
  const styles = {
    ok: { background: 'rgba(0,204,122,.12)', color: 'var(--green)' },
    fail: { background: 'rgba(240,62,62,.12)', color: 'var(--red)' },
    surge: { background: 'rgba(245,166,35,.12)', color: 'var(--amber)' },
  }
  return <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, flexShrink: 0, ...styles[type] || styles.ok }}>{type}</span>
}

function Spinner() {
  return <div style={{ width: 16, height: 16, border: '2px solid var(--b2)', borderTopColor: 'var(--acc)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
}

export default function MonitorPage() {
  const [hours, setHours] = useState(24)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.results(hours)
      setRows(Array.isArray(data) ? data : [])
      setLastUpdated(new Date())
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [hours])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

  const total = rows.length
  const ok = rows.filter(r => r.status === 1).length
  const failed = total - ok
  const uptime = total ? Math.round(ok / total * 100) : 0
  const avgTtfb = total ? Math.round(rows.reduce((s, r) => s + (r.ttfb_ms || 0), 0) / total) : 0
  const surgeRuns = rows.filter(r => r.mode === 'surge').length

  const bucketMs = hours <= 1 ? 5*60*1000 : hours <= 6 ? 15*60*1000 : hours <= 24 ? 3600*1000 : 6*3600*1000
  const buckets = {}
  rows.forEach(r => {
    const t = Math.floor(new Date(r.checked_at).getTime() / bucketMs) * bucketMs
    if (!buckets[t]) buckets[t] = { ok: 0, fail: 0 }
    r.status === 1 ? buckets[t].ok++ : buckets[t].fail++
  })
  const chartData = Object.keys(buckets).map(Number).sort().map(t => ({
    time: hours <= 24 ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    ok: buckets[t].ok, fail: buckets[t].fail,
  }))

  const byRegion = {}
  rows.forEach(r => {
    if (!byRegion[r.region]) byRegion[r.region] = { ok: 0, fail: 0, ttfbs: [], colo: r.cf_colo }
    r.status === 1 ? byRegion[r.region].ok++ : byRegion[r.region].fail++
    if (r.ttfb_ms) byRegion[r.region].ttfbs.push(r.ttfb_ms)
  })
  const maxRuns = Math.max(...Object.values(byRegion).map(v => v.ok + v.fail), 1)
  const feed = rows.slice(0, 20)
  const hoursLabel = hours < 24 ? `${hours}h` : hours === 168 ? '7d' : hours === 720 ? '30d' : '24h'

  return (
    <div style={{ padding: 16, animation: 'fadeIn .2s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {HOURS_OPTS.map(o => (
            <button key={o.v} onClick={() => setHours(o.v)} style={{
              fontSize: 11, padding: '4px 12px', borderRadius: 5,
              border: '0.5px solid ' + (hours === o.v ? 'var(--acc)' : 'var(--b1)'),
              background: 'transparent', color: hours === o.v ? 'var(--acc)' : 'var(--mu)',
            }}>{o.label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {loading ? <Spinner /> : <div style={{ fontSize: 10, color: 'var(--hi)', fontFamily: 'var(--mono)' }}>updated {lastUpdated?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
        <button onClick={load} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '0.5px solid var(--b2)', background: 'transparent', color: 'var(--mu)' }}>↻ refresh</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
        <MetricCard label="total runs" value={total.toLocaleString()} sub={`last ${hoursLabel}`} />
        <MetricCard label="uptime" value={`${uptime}%`} sub={`${ok} ok / ${failed} failed`} color={uptime >= 99 ? 'var(--green)' : uptime >= 90 ? 'var(--tx)' : 'var(--red)'} />
        <MetricCard label="avg ttfb" value={`${avgTtfb}ms`} sub="across all regions" />
        <MetricCard label="surge runs" value={surgeRuns} sub="campaign tests" />
      </div>

      <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b1)', borderRadius: 8, padding: '12px 14px', marginBottom: 8 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mu)', fontFamily: 'var(--mono)', marginBottom: 10 }}>runs over time — {hoursLabel}</div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
          {[['var(--green)', 'successful'], ['var(--red)', 'failed']].map(([c, l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mu)' }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }} barSize={chartData.length > 20 ? 4 : 10}>
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#4a4a60' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#4a4a60' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: 'var(--s2)', border: '0.5px solid var(--b2)', borderRadius: 6, fontSize: 11 }} />
            <Bar dataKey="ok" stackId="a" fill="#00cc7a" />
            <Bar dataKey="fail" stackId="a" fill="#f03e3e" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b1)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mu)', fontFamily: 'var(--mono)', marginBottom: 10 }}>regions</div>
          {REGIONS.map(reg => {
            const d = byRegion[reg]
            if (!d) return (
              <div key={reg} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '0.5px solid var(--b1)' }}>
                <Dot status="na" />
                <div style={{ fontSize: 11, width: 110 }}>{FLAGS[reg]} {reg}</div>
                <div style={{ flex: 1, background: 'var(--s3)', borderRadius: 2, height: 4 }} />
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--hi)', width: 42, textAlign: 'right' }}>—</div>
              </div>
            )
            const tot = d.ok + d.fail
            const pct = Math.round(tot / maxRuns * 100)
            const avgT = d.ttfbs.length ? Math.round(d.ttfbs.reduce((a, b) => a + b, 0) / d.ttfbs.length) : 0
            const dotStatus = d.fail === 0 ? 'ok' : d.ok === 0 ? 'fail' : 'partial'
            const barColor = d.fail === 0 ? 'var(--green)' : d.ok === 0 ? 'var(--red)' : 'var(--amber)'
            return (
              <div key={reg} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '0.5px solid var(--b1)' }}>
                <Dot status={dotStatus} />
                <div style={{ fontSize: 11, width: 110, flexShrink: 0 }}>{FLAGS[reg]} {reg}</div>
                <div style={{ flex: 1, background: 'var(--s3)', borderRadius: 2, height: 4 }}>
                  <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: barColor, transition: 'width .5s' }} />
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--mu)', width: 42, textAlign: 'right' }}>{avgT}ms</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--hi)', width: 28, textAlign: 'right' }}>{d.colo || '—'}</div>
              </div>
            )
          })}
        </div>
        <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b1)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mu)', fontFamily: 'var(--mono)', marginBottom: 10 }}>live feed</div>
          {feed.length === 0 && <div style={{ fontSize: 12, color: 'var(--hi)', textAlign: 'center', padding: '1rem' }}>no data in this range</div>}
          {feed.map((r, i) => {
            const type = r.status === 1 ? 'ok' : r.mode === 'surge' ? 'surge' : 'fail'
            const msg = r.status === 1 ? `${r.region} · ${Math.round(r.ttfb_ms)}ms · ${r.cf_colo || '—'}` : `${r.region} · timeout / blocked`
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', borderBottom: '0.5px solid var(--b1)' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--hi)', whiteSpace: 'nowrap', flexShrink: 0, width: 44 }}>{new Date(r.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                <FeedBadge type={type} />
                <div style={{ fontSize: 11, color: 'var(--mu)', lineHeight: 1.4 }}>{msg}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
