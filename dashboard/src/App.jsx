import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import LockScreen from './components/LockScreen'
import Nav from './components/Nav'
import MonitorPage from './pages/MonitorPage'
import ControlPage from './pages/ControlPage'

function AppInner() {
  const { authed, checking } = useAuth()
  if (checking) return null
  if (!authed) return <LockScreen />
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Nav />
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Routes>
          <Route path="/" element={<MonitorPage />} />
          <Route path="/control" element={<ControlPage />} />
        </Routes>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppInner />
      </BrowserRouter>
    </AuthProvider>
  )
}
