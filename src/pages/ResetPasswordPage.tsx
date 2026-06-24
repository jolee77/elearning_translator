import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AuthChangeEvent } from '@supabase/supabase-js'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../hooks/ToastProvider'
import { supabase } from '../lib/supabase'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true

    const { data: authListener } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true)
        setChecking(false)
      }
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return
      if (session) {
        setReady(true)
      }
      setChecking(false)
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (password.length < 8) {
      showToast('비밀번호는 8자 이상이어야 합니다.', 'error')
      return
    }

    if (password !== confirm) {
      showToast('비밀번호 확인이 일치하지 않습니다.', 'error')
      return
    }

    setSubmitting(true)

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      showToast(error.message, 'error')
      setSubmitting(false)
      return
    }

    showToast('비밀번호가 변경되었습니다. 로그인해 주세요.', 'success')
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
    setSubmitting(false)
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary to-primary-700">
        <Spinner className="text-white" size="md" />
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary to-primary-700 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl text-center">
          <h1 className="text-xl font-bold text-primary">링크가 만료되었습니다</h1>
          <p className="mt-3 text-sm text-gray-600">
            비밀번호 재설정 메일을 다시 요청해 주세요.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
          >
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary to-primary-700 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-primary">새 비밀번호 설정</h1>
          <p className="mt-2 text-sm text-gray-500">사용할 비밀번호를 입력해 주세요.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
              새 비밀번호
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="8자 이상"
            />
          </div>

          <div>
            <label htmlFor="confirm" className="mb-1 block text-sm font-medium text-gray-700">
              비밀번호 확인
            </label>
            <input
              id="confirm"
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="비밀번호 다시 입력"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
          >
            {submitting && <Spinner className="text-white" />}
            {submitting ? '저장 중...' : '비밀번호 저장'}
          </button>
        </form>
      </div>
    </div>
  )
}
