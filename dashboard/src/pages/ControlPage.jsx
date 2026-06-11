import { useState, useEffect } from 'react'
import { api } from '../lib/api'

function SectionTitle({ children }) {
  return <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--mu)', fontFamily: 'var(--mono)', marginBottom: 10 }}>{children}</div>
}

function Card({ children, style }) {
  return <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b1)', borderRadius: 8, padding: '14px 16px', ...style }}>{children}</div>
}

function Btn({ children, onClick, variant = 'default', disabled, style }) {
  const variants = {
    default: { border: '0.5px solid var(--b3)', color: 'var(--tx)', background: 'transparent' },
    primary: { border: '0.5px solid var(--acc)', color: '#000', background: 'var(--acc)', fontWeight: 500 },
    danger: { border: '0.5px solid rgba(240,62,62,.4)', color: 'var(--red)', background: 'transparent' },
  }
  return (
    <button onClick={onClick} disabled={disabled} style={{ fontSize: 11, padding: '7px 14px', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1, transition: 'opacity .15s', whiteSpace: 'nowrap', ...variants[variant], ...style }}>{children}</button>
  )
}

function Toggle({ on, onChange }) {
  return (
    <div onClick={() => onChange(!on)} style={{ width: 28, height: 16, background: on ? 'var(--acc)' : 'var(--s3)', borderRadius: 8, position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background .2s' }}>
      <div style={{ width: 12, height: 12, background: '#fff', borderRadius: '50%', position: 'absolute', top: 2, left: on ? 14 : 2, transition: 'left .15s' }} />
    </div>
  )
}

function StatusPill({ status }) {
  if (!status) return null
  const colors = { success: 'rgba(0,204,122,.12)', error: 'rgba(240,62,62,.12)', loading: 'rgba(77,148,255,.12)' }
  const textColors = { success: 'var(--green)', error: 'var(--red)', loading: 'var(--blue)' }
  return <div style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, background: colors[status.type], color: textColors[status.type], marginTop: 8 }}>{status.msg}</div>
}

export default function ControlPage() {
  const [triggerStatus, setTriggerStatus] = useState(null)
  const [surgeStatus, setSurgeStatus] = useState(null)
  const [targetUrl, setTargetUrl] = useState('')
  const [targetName, setTargetName] = useState('')
  const [targetStatus, setTargetStatus] = useState(null)
  const [savedTargets, setSavedTargets] = useState([])
  const [activeTarget, setActiveTarget] = useState(null)
  const [discordStatus, setDiscordStatus] = useState(null)
  const [notifyFailures, setNotifyFailures] = useState(true)
  const [notifyEveryRun, setNotifyEveryRun] = useState(false)
  const [notifySurge, setNotifySurge] = useState(true)
  const [scheduleInterval, setScheduleInterval] = useState('5')
  const [scheduleRegions, setScheduleRegions] = useState('all')
  const [randomEnabled, setRandomEnabled] = useState(true)
  const [campaignEnabled, setCampaignEnabled] = useState(true)

  useEffect(() => {
    api.activeTarget().then(t => { setActiveTarget(t); setTargetUrl(t?.url || ''); setTargetName(t?.name || '') }).catch(() => {})
    api.targets().then(setSavedTargets).catch(() => {})
  }, [])

  async function runStandard() {
    setTriggerStatus({ type: 'loading', msg: 'Dispatching standard check…' })
    try { await api.trigger('standard'); setTriggerStatus({ type: 'success', msg: '✓ Dispatched — 6 runners starting' }) }
    catch (e) { setTriggerStatus({ type: 'error', msg: e.message }) }
  }

  async function runSurge() {
    setSurgeStatus({ type: 'loading', msg: 'Dispatching surge test…' })
    try { await api.trigger('surge'); setSurgeStatus({ type: 'success', msg: '✓ Surge dispatched — 20 concurrent requests per region' }) }
    catch (e) { setSurgeStatus({ type: 'error', msg: e.message }) }
  }

  async function updateTarget() {
    if (!targetUrl.trim()) return
    setTargetStatus({ type: 'loading', msg: 'Updating target…' })
    try {
      await api.setTarget(targetUrl.trim(), targetName.trim() || targetUrl.trim())
      setTargetStatus({ type: 'success', msg: '✓ Target updated — next run will use this URL' })
      setActiveTarget({ url: targetUrl, name: targetName || targetUrl })
      api.targets().then(setSavedTargets)
    } catch (e) { setTargetStatus({ type: 'error', msg: e.message }) }
  }

  async function testDiscord() {
    setDiscordStatus({ type: 'loading', msg: 'Sending test message…' })
    try {
      const res = await api.testDiscord()
      setDiscordStatus({ type: res.sent ? 'success' : 'error', msg: res.sent ? '✓ Test message sent to Discord' : 'Failed to send' })
    } catch (e) { setDiscordStatus({ type: 'error', msg: e.message }) }
  }

  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, animation: 'fadeIn .2s ease', alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Card>
          <SectionTitle>manual triggers</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '0.5px solid var(--b1)', marginBottom: 12 }}>
            <div><div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>standard check</div><div style={{ fontSize: 11, color: 'var(--mu)' }}>one request per region · 6 runners in parallel</div></div>
            <Btn onClick={runStandard}>Run now</Btn>
          </div>
          <StatusPill status={triggerStatus} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: triggerStatus ? 12 : 0 }}>
            <div><div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>surge test</div><div style={{ fontSize: 11, color: 'var(--mu)' }}>20 concurrent requests per region · simulates campaign traffic</div></div>
            <Btn onClick={runSurge} variant="primary">Trigger surge</Btn>
          </div>
          <StatusPill status={surgeStatus} />
        </Card>
        <Card>
          <SectionTitle>schedule</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div style={{ background: 'var(--s2)', border: '0.5px solid var(--b1)', borderRadius: 6, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1 }}><div style={{ fontSize: 11, fontWeight: 500, marginBottom: 2 }}>random interval</div><div style={{ fontSize: 10, color: 'var(--mu)' }}>~30% of 5-min ticks</div></div>
                <Toggle on={randomEnabled} onChange={setRandomEnabled} />
              </div>
            </div>
            <div style={{ background: 'var(--s2)', border: '0.5px solid var(--b1)', borderRadius: 6, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1 }}><div style={{ fontSize: 11, fontWeight: 500, marginBottom: 2 }}>campaign surge</div><div style={{ fontSize: 10, color: 'var(--mu)' }}>on webhook POST</div></div>
                <Toggle on={campaignEnabled} onChange={setCampaignEnabled} />
              </div>
            </div>
            <div style={{ background: 'var(--s2)', border: '0.5px solid var(--b1)', borderRadius: 6, padding: '10px 12px', gridColumn: 'span 2' }}>
              <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 8 }}>custom schedule</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={scheduleInterval} onChange={e => setScheduleInterval(e.target.value)} style={{ flex: 1, fontSize: 11, padding: '6px 8px', borderRadius: 5, border: '0.5px solid var(--b2)', background: 'var(--s1)', color: 'var(--tx)' }}>
                  <option value="5">Every 5 min</option>
                  <option value="15">Every 15 min</option>
                  <option value="30">Every 30 min</option>
                  <option value="60">Every hour</option>
                </select>
                <select value={scheduleRegions} onChange={e => setScheduleRegions(e.target.value)} style={{ flex: 1, fontSize: 11, padding: '6px 8px', borderRadius: 5, border: '0.5px solid var(--b2)', background: 'var(--s1)', color: 'var(--tx)' }}>
                  <option value="all">All regions</option>
                  <option value="us-east,eu-west">US + EU only</option>
                  <option value="ap-southeast,sa-east,me-south,af-south">APAC + SA + ME + AF</option>
                </select>
                <Btn>Save</Btn>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--hi)', fontFamily: 'var(--mono)' }}>note: toggle changes require reactivating n8n workflows A + B</div>
        </Card>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Card>
          <SectionTitle>target url</SectionTitle>
          {activeTarget && (
            <div style={{ background: 'var(--s2)', border: '0.5px solid var(--b1)', borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'rgba(0,204,122,.12)', color: 'var(--green)' }}>active</span>
                <div style={{ fontSize: 11, fontWeight: 500 }}>{activeTarget.name}</div>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--mu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeTarget.url}</div>
            </div>
          )}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--mu)', marginBottom: 4 }}>name (optional)</div>
            <input value={targetName} onChange={e => setTargetName(e.target.value)} placeholder="e.g. Bug Seek Expedition" style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '0.5px solid var(--b2)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 11 }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--mu)', marginBottom: 4 }}>url</div>
            <input value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://example.itch.io/game" style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '0.5px solid var(--b2)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 11 }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn onClick={updateTarget} variant="primary" style={{ flex: 1 }}>Update target</Btn>
            <Btn onClick={() => { setTargetUrl(''); setTargetName('') }} variant="danger">Clear</Btn>
          </div>
          <StatusPill status={targetStatus} />
          {savedTargets.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.06em', fontFamily: 'var(--mono)', marginBottom: 6 }}>saved targets</div>
              {savedTargets.slice(0, 5).map((t, i) => (
                <div key={i} onClick={() => { setTargetUrl(t.url); setTargetName(t.name) }}
                  style={{ fontSize: 10, color: t.active ? 'var(--acc)' : 'var(--mu)', fontFamily: 'var(--mono)', padding: '5px 0', borderBottom: '0.5px solid var(--b1)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.active ? '● ' : '○ '}{t.name || t.url}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>notifications</SectionTitle>
          <div style={{ background: 'rgba(88,101,242,.08)', border: '0.5px solid rgba(88,101,242,.25)', borderRadius: 6, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 28, height: 28, background: 'rgb(88,101,242)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>⚙</div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 11, fontWeight: 500, marginBottom: 2 }}>Discord webhook</div><div style={{ fontSize: 10, color: 'var(--mu)' }}>failure alerts + run logs</div></div>
            <Toggle on={true} onChange={() => {}} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--mu)', marginBottom: 4 }}>webhook url</div>
            <input placeholder="https://discord.com/api/webhooks/…" style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '0.5px solid var(--b2)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 11 }} />
            <div style={{ fontSize: 10, color: 'var(--hi)', marginTop: 4, fontFamily: 'var(--mono)' }}>set DISCORD_WEBHOOK_URL in Cloudflare Worker secrets</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {[[notifyFailures, setNotifyFailures, 'alert on failure'], [notifyEveryRun, setNotifyEveryRun, 'log every run'], [notifySurge, setNotifySurge, 'surge report on complete']].map(([on, setOn, label]) => (
              <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--mu)', cursor: 'pointer' }}>
                <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} style={{ accentColor: 'var(--acc)' }} />{label}
              </label>
            ))}
          </div>
          <Btn onClick={testDiscord} style={{ width: '100%' }}>Send test message</Btn>
          <StatusPill status={discordStatus} />
        </Card>
      </div>
    </div>
  )
}
