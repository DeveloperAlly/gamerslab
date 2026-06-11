import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export default function Nav() {
  const [target, setTarget] = useState(null)

  useEffect(() => {
    api.activeTarget().then(setTarget).catch(() => {})
  }, [])

  const tabStyle = (isActive) => ({
    fontSize: 12, padding: '0 14px', height: 40,
    display: 'flex', alignItems: 'center',
    borderBottom: isActive ? '2px solid var(--acc)' : '2px solid transparent',
    color: isActive ? 'var(--tx)' : 'var(--mu)',
    textDecoration: 'none', whiteSpace: 'nowrap', transition: 'all .15s',
  })

  return (
    <nav style={{ background: 'var(--s1)', borderBottom: '0.5px solid var(--b1)', padding: '0 16px', display: 'flex', alignItems: 'center', height: 40, flexShrink: 0 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--acc)', letterSpacing: '.08em', marginRight: 20 }}>GL / MONITOR</div>
      <NavLink to="/" end style={({ isActive }) => tabStyle(isActive)}>Monitor</NavLink>
      <NavLink to="/control" style={({ isActive }) => tabStyle(isActive)}>Control</NavLink>
      <div style={{ flex: 1 }} />
      {target && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--mu)', background: 'var(--s2)', border: '0.5px solid var(--b2)', borderRadius: 4, padding: '3px 8px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {target.url}
        </div>
      )}
    </nav>
  )
}
