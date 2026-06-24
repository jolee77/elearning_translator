import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AuthChangeEvent } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

/** 비밀번호 재설정 메일 링크로 루트(/)에 도착해도 /reset-password 로 이동 */
export function AuthRecoveryRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event === 'PASSWORD_RECOVERY') {
        navigate('/reset-password', { replace: true })
      }
    })

    return () => subscription.unsubscribe()
  }, [navigate])

  return null
}
