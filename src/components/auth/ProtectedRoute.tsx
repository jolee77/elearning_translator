import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export function ProtectedRoute() {
  const { user, session, loading } = useAuth()
  const [sessionChecked, setSessionChecked] = useState(false)
  const [storedSession, setStoredSession] = useState(false)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (!active) return
      setStoredSession(!!currentSession)
      setSessionChecked(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setStoredSession(!!nextSession)
      setSessionChecked(true)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  if (loading || !sessionChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-gray-500">로딩 중...</div>
      </div>
    )
  }

  const isAuthenticated = !!(user ?? session ?? storedSession)

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

export function AdminRoute() {
  const { profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-gray-500">로딩 중...</div>
      </div>
    )
  }

  if (profile?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
