import { useState } from 'react'
import { useAuth } from '../lib/auth'

export default function LockScreen() {
  const { login } = useAuth()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setErr('')
    const ok = await login(pw)
    if (!ok) { setErr('Incorrect password'); setPw('') }
    setLoading(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <form onSubmit={submit} style={{ width: 340, padding: '2.5rem 2rem', background: 'var(--s1)', border: '0.5px solid var(--b3)', borderRadius: 12 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--acc)', letterSpacing: '.08em', marginBottom: '1.5rem' }}>GAMERSLAB / MONITOR</div>
        <div style={{ fontSize: 20, fontWeight: 500, marginBottom: '.4rem' }}>Analytics</div>
        <div style={{ fontSize: 13, color: 'var(--mu)', marginBottom: '1.5rem' }}>Internal access only</div>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" autoFocus
          style={{ width: '100%', padding: '10px 14px', background: 'var(--s2)', border: '0.5px solid var(--b3)', borderRadius: 8, color: 'var(--tx)', fontSize: 14, outline: 'none', marginBottom: 10 }} />
        <button type="submit" disabled={loading}
          style={{ width: '100%', padding: 10, background: 'var(--acc)', color: '#000', fontWeight: 500, fontSize: 14, border: 'none', borderRadius: 8, opacity: loading ? .7 : 1 }}>
          {loading ? 'Checking…' : 'Enter'}
        </button>
        {err && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>{err}</div>}
      </form>
    </div>
  )
}
