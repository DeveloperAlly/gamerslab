import { useState, useEffect } from 'react'
import { api } from '../lib/api'

function Label({ children }) {
  return <div style={{ fontSize: 10, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.07em', fontFamily: 'var(--mono)', marginBottom: 6 }}>{children}</div>
}

function Card({ children, style }) {
  return <div style={{ background: 'var(--s1)', border: '0.5px solid var(--b2)', borderRadius: 10, padding: '16px', ...style }}>{children}</div>
}

function Divider() {
  return <div style={{ borderTop: '0.5px solid var(--b1)', margin: '12px 0' }} />
}

function Btn({ children, onClick, variant = 'default', disabled, style, fullWidth }) {
  const base = { fontSize: 12, padding: '8px 16px', borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1, transition: 'all .15s', whiteSpace: 'nowrap', width: fullWidth ? '100%' : 'auto' }
  const variants = {
    default: { border: '0.5px solid var(--b3)', color: 'var(--tx)', background: 'transparent' },
    primary: { border: 'none', color: '#000', background: 'var(--acc)', fontWeight: 500 },
    danger: { border: '0.5px solid rgba(240,62,62,.35)', color: 'var(--red)', background: 'var(--red-dim)' },
    surge: { border: 'none', color: '#000', background: 'var(--amber)', fontWeight: 500 },
  }
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>{children}</button>
}

function Toggle({ on, onChange, disabled, loading }) {
  return (
    <div onClick={() => !disabled && !loading && onChange(!on)}
      style={{ width: 32, height: 18, background: on ? 'var(--acc)' : 'var(--s3)', borderRadius: 9, position: 'relative', cursor: disabled || loading ? 'not-allowed' : 'pointer', flexShrink: 0, transition: 'background .2s', opacity: disabled ? .5 : 1 }}>
      {loading
        ? <div style={{ width: 12, height: 12, border: '1.5px solid rgba(0,0,0,.3)', borderTopColor: '#000', borderRadius: '50%', position: 'absolute', top: 3, left: on ? 17 : 3, animation: 'spin .7s linear infinite' }} />
        : <div style={{ width: 14, height: 14, background: '#fff', borderRadius: '50%', position: 'absolute', top: 2, left: on ? 16 : 2, transition: 'left .15s' }} />
      }
    </div>
  )
}

function Status({ status }) {
  if (!status) return null
  const cfg = {
    success: { bg: 'var(--green-dim)', color: 'var(--green)', icon: '✓' },
    error: { bg: 'var(--red-dim)', color: 'var(--red)', icon: '✗' },
    loading: { bg: 'rgba(77,148,255,.08)', color: 'var(--blue)', icon: '…' },
  }
  const c = cfg[status.type] || cfg.loading
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '8px 12px', borderRadius: 7, background: c.bg, color: c.color, marginTop: 10 }}>
      <span style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{c.icon}</span> {status.msg}
    </div>
  )
}

function Input({ value, onChange, placeholder }) {
  return (
    <input value={value} onChange={onChange} placeholder={placeholder}
      style={{ width: '100%', padding: '8px 11px', borderRadius: 7, border: '0.5px solid var(--b2)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 11, outline: 'none', transition: 'border-color .15s' }}
      onFocus={e => e.target.style.borderColor = 'var(--acc)'}
      onBlur={e => e.target.style.borderColor = 'var(--b2)'}
    />
  )
}

const INTERVAL_OPTIONS = [
  { label: 'Every 1 min', value: 1 },
  { label: 'Every 5 min', value: 5 },
  { label: 'Every 15 min', value: 15 },
  { label: 'Every 30 min', value: 30 },
  { label: 'Every hour', value: 60 },
]

const SURGE_INTERVAL_OPTIONS = [
  { label: 'Every 1 hour', value: 60 },
  { label: 'Every 2 hours', value: 120 },
  { label: 'Every 4 hours', value: 240 },
  { label: 'Every 6 hours', value: 360 },
  { label: 'Every 12 hours', value: 720 },
]

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

  // Standard schedule (Workflow A)
  const [workflowActive, setWorkflowActive] = useState(null)
  const [intervalMinutes, setIntervalMinutes] = useState(5)
  const [scheduleLoading, setScheduleLoading] = useState(true)
  const [scheduleStatus, setScheduleStatus] = useState(null)
  const [toggleLoading, setToggleLoading] = useState(false)

  // Surge schedule (Workflow E) — UI state only, controlled in n8n directly
  const [surgeScheduleActive, setSurgeScheduleActive] = useState(true)
  const [surgeIntervalMinutes, setSurgeIntervalMinutes] = useState(120)

  useEffect(() => {
    api.activeTarget().then(t => { setActiveTarget(t); setTargetUrl(t?.url || ''); setTargetName(t?.name || '') }).catch(() => {})
    api.targets().then(setSavedTargets).catch(() => {})
    api.getWorkflowStatus()
      .then(s => { setWorkflowActive(s.active); setIntervalMinutes(s.intervalMinutes || 5) })
      .catch(() => setWorkflowActive(null))
      .finally(() => setScheduleLoading(false))
  }, [])

  async function runStandard() {
    setTriggerStatus({ type: 'loading', msg: 'Dispatching standard check…' })
    try { await api.trigger('standard'); setTriggerStatus({ type: 'success', msg: 'Dispatched — 6 runners starting across all regions' }) }
    catch (e) { setTriggerStatus({ type: 'error', msg: e.message }) }
  }

  async function runSurge() {
    setSurgeStatus({ type: 'loading', msg: 'Dispatching surge…' })
    try { await api.trigger('surge'); setSurgeStatus({ type: 'success', msg: 'Surge dispatched — 20 concurrent requests per region' }) }
    catch (e) { setSurgeStatus({ type: 'error', msg: e.message }) }
  }

  async function toggleWorkflow(active) {
    setToggleLoading(true)
    try {
      active ? await api.activateWorkflow() : await api.deactivateWorkflow()
      setWorkflowActive(active)
      setScheduleStatus({ type: 'success', msg: active ? 'Scheduler activated' : 'Scheduler paused' })
    } catch (e) {
      setScheduleStatus({ type: 'error', msg: e.message })
    }
    setToggleLoading(false)
  }

  async function saveSchedule() {
    setScheduleStatus({ type: 'loading', msg: 'Updating schedule…' })
    try {
      await api.setSchedule(intervalMinutes)
      setScheduleStatus({ type: 'success', msg: `Schedule updated — checks every ${intervalMinutes} min` })
    } catch (e) {
      setScheduleStatus({ type: 'error', msg: e.message })
    }
  }

  async function updateTarget() {
    if (!targetUrl.trim()) return
    setTargetStatus({ type: 'loading', msg: 'Updating target…' })
    try {
      await api.setTarget(targetUrl.trim(), targetName.trim() || targetUrl.trim())
      setTargetStatus({ type: 'success', msg: 'Target updated — next run will use this URL' })
      setActiveTarget({ url: targetUrl.trim(), name: targetName.trim() || targetUrl.trim() })
      api.targets().then(setSavedTargets)
    } catch (e) { setTargetStatus({ type: 'error', msg: e.message }) }
  }

  async function testDiscord() {
    setDiscordStatus({ type: 'loading', msg: 'Sending test message…' })
    try {
      const res = await api.testDiscord()
      setDiscordStatus({ type: res.sent ? 'success' : 'error', msg: res.sent ? 'Test message sent to #gamers-lab-monitor' : 'Failed — check DISCORD_WEBHOOK_URL in Worker secrets' })
    } catch (e) { setDiscordStatus({ type: 'error', msg: e.message }) }
  }

  const selectStyle = { fontSize: 11, padding: '7px 10px', borderRadius: 6, border: '0.5px solid var(--b2)', background: 'var(--s1)', color: 'var(--tx)', outline: 'none', width: '100%' }

  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, animation: 'fadeIn .2s ease', alignItems: 'start' }}>

      {/* LEFT */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* triggers */}
        <Card>
          <Label>manual triggers</Label>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Standard check</div>
              <div style={{ fontSize: 11, color: 'var(--mu)', marginTop: 2 }}>1 request per region · 6 runners in parallel</div>
            </div>
            <Btn onClick={runStandard}>Run now</Btn>
          </div>
          <Status status={triggerStatus} />
          <Divider />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Surge test</div>
              <div style={{ fontSize: 11, color: 'var(--mu)', marginTop: 2 }}>20 concurrent requests per region · simulates campaign spike</div>
            </div>
            <Btn onClick={runSurge} variant="surge">Trigger surge</Btn>
          </div>
          <Status status={surgeStatus} />
        </Card>

        {/* standard schedule */}
        <Card>
          <Label>standard check schedule</Label>
          <div style={{ background: 'var(--s2)', border: '0.5px solid var(--b1)', borderRadius: 7, padding: '12px', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500 }}>Random interval — n8n Workflow A</div>
                <div style={{ fontSize: 10, color: 'var(--mu)', marginTop: 2 }}>
                  {scheduleLoading ? 'Loading…' : workflowActive === null ? 'Status unavailable' : workflowActive ? `Active · every ${intervalMinutes} min · ~30% fire rate` : 'Paused — activate in n8n'}
                </div>
              </div>
              <Toggle on={workflowActive === true} onChange={toggleWorkflow} loading={toggleLoading} disabled={scheduleLoading || workflowActive === null} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={intervalMinutes} onChange={e => setIntervalMinutes(parseInt(e.target.value))} style={{ ...selectStyle, flex: 1 }}>
                {INTERVAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Btn onClick={saveSchedule} variant="primary">Save</Btn>
            </div>
          </div>
          <Status status={scheduleStatus} />
        </Card>

        {/* surge schedule */}
        <Card>
          <Label>surge schedule</Label>
          <div style={{ background: 'var(--s2)', border: '0.5px solid var(--b1)', borderRadius: 7, padding: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500 }}>Automated surge — n8n Workflow E</div>
                <div style={{ fontSize: 10, color: 'var(--mu)', marginTop: 2 }}>
                  {surgeScheduleActive ? `Active · ${SURGE_INTERVAL_OPTIONS.find(o => o.value === surgeIntervalMinutes)?.label || 'every 2 hours'} · 50% random gate` : 'Paused'}
                </div>
              </div>
              <Toggle on={surgeScheduleActive} onChange={setSurgeScheduleActive} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={surgeIntervalMinutes} onChange={e => setSurgeIntervalMinutes(parseInt(e.target.value))} style={{ ...selectStyle, flex: 1 }}>
                {SURGE_INTERVAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Btn variant="surge" onClick={() => {}}>Save</Btn>
            </div>
            <div style={{ fontSize: 10, color: 'var(--hi)', fontFamily: 'var(--mono)', marginTop: 8 }}>
              fires on average every {surgeIntervalMinutes * 2} min · Discord notified on each fire · runs overnight automatically
            </div>
          </div>
        </Card>

      </div>

      {/* RIGHT */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* target URL */}
        <Card>
          <Label>monitored target</Label>
          {activeTarget && (
            <div style={{ background: 'var(--s2)', border: '0.5px solid var(--b2)', borderRadius: 7, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', animation: 'pulse 2s infinite' }} />
                <span style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'var(--mono)' }}>active</span>
                <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 4 }}>{activeTarget.name}</span>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--mu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeTarget.url}</div>
            </div>
          )}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--mu)', marginBottom: 5 }}>Display name</div>
            <Input value={targetName} onChange={e => setTargetName(e.target.value)} placeholder="e.g. Bug Seek: Expedition Edition" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--mu)', marginBottom: 5 }}>URL</div>
            <Input value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://example.itch.io/game" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={updateTarget} variant="primary" style={{ flex: 1 }}>Update target</Btn>
            <Btn onClick={() => { setTargetUrl(''); setTargetName('') }} variant="danger">Clear</Btn>
          </div>
          <Status status={targetStatus} />
          {savedTargets.length > 0 && (
            <>
              <Divider />
              <Label>saved targets</Label>
              {savedTargets.slice(0, 5).map((t, i) => (
                <div key={i} onClick={() => { setTargetUrl(t.url); setTargetName(t.name || '') }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '0.5px solid var(--b1)', cursor: 'pointer' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: t.active ? 'var(--green)' : 'var(--hi)', flexShrink: 0 }} />
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontSize: 11, fontWeight: t.active ? 500 : 400, color: t.active ? 'var(--tx)' : 'var(--mu)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name || t.url}</div>
                    <div style={{ fontSize: 10, color: 'var(--hi)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.url}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </Card>

        {/* Discord */}
        <Card>
          <Label>discord alerts</Label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(88,101,242,.07)', border: '0.5px solid rgba(88,101,242,.2)', borderRadius: 8, marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, background: 'rgb(88,101,242)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>🎮</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>Discord Bot GamersLab</div>
              <div style={{ fontSize: 10, color: 'var(--mu)', marginTop: 1 }}>#gamers-lab-monitor channel</div>
            </div>
            <Toggle on={true} onChange={() => {}} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {[
              [notifyFailures, setNotifyFailures, 'Alert on region failure'],
              [notifyEveryRun, setNotifyEveryRun, 'Log every run'],
              [notifySurge, setNotifySurge, 'Surge report on campaign complete'],
            ].map(([on, setOn, label]) => (
              <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--mu)', cursor: 'pointer', userSelect: 'none' }}>
                <Toggle on={on} onChange={setOn} />
                {label}
              </label>
            ))}
          </div>
          <Btn onClick={testDiscord} fullWidth>Send test message to Discord</Btn>
          <Status status={discordStatus} />
        </Card>

      </div>
    </div>
  )
}
