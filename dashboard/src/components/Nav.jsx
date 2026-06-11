import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export default function Nav() {
  const [target, setTarget] = useState(null)

  useEffect(() => {
    api.activeTarget().then(setTarget).catch(() => {})
  }, [])

  return (
    <nav style={{
      background: 'var(--s1)', borderBottom: '0.5px solid var(--b1)',
      padding: '0 16px', display: 'flex', alignItems: 'center',
      height: 44, flexShrink: 0, gap: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 24 }}>
        <img src="/gamerslab-logo.jpg" alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover' }} />
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--acc)', letterSpacing: '.08em', fontWeight: 500 }}>GL / MONITOR</div>
      </div>
      <NavLink to="/" end style={({ isActive }) => ({
        fontSize: 12, padding: '0 14px', height: 44, display: 'flex', alignItems: 'center',
        borderBottom: isActive ? '2px solid var(--acc)' : '2px solid transparent',
        color: isActive ? 'var(--tx)' : 'var(--mu)',
        textDecoration: 'none', transition: 'color .15s',
      })}>Monitor</NavLink>
      <NavLink to="/control" style={({ isActive }) => ({
        fontSize: 12, padding: '0 14px', height: 44, display: 'flex', alignItems: 'center',
        borderBottom: isActive ? '2px solid var(--acc)' : '2px solid transparent',
        color: isActive ? 'var(--tx)' : 'var(--mu)',
        textDecoration: 'none', transition: 'color .15s',
      })}>Control</NavLink>
      <div style={{ flex: 1 }} />
      {target && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', animation: 'pulse 2s infinite' }} />
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--mu)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {target.name || target.url}
          </div>
        </div>
      )}
    </nav>
  )
}
