import { createContext, useContext, useState, useEffect } from 'react'

const AuthCtx = createContext(null)
const PASS_HASH = import.meta.env.VITE_PASS_HASH || ''
const SESSION_KEY = 'gl_auth'

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function AuthProvider({ children }) {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY)
    if (stored && stored === PASS_HASH) setAuthed(true)
    setChecking(false)
  }, [])

  async function login(password) {
    const hash = await sha256(password)
    if (hash === PASS_HASH) {
      sessionStorage.setItem(SESSION_KEY, hash)
      setAuthed(true)
      return true
    }
    return false
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY)
    setAuthed(false)
  }

  return <AuthCtx.Provider value={{ authed, checking, login, logout }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
