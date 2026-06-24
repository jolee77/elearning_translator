import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Spinner } from '../components/ui/Spinner'
import { useToast } from '../hooks/ToastProvider'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

export function LoginPage() {
  const { user, loading, signIn } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    const result = await signIn(email.trim(), password)

    if (result.error) {
      showToast(result.error, 'error')
      setSubmitting(false)
      return
    }

    if (!result.session) {
      showToast('로그인 세션을 확인하지 못했습니다. 다시 시도해 주세요.', 'error')
      setSubmitting(false)
      return
    }

    navigate('/dashboard', { replace: true })
    setSubmitting(false)
  }

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      showToast('비밀번호 재설정을 위해 이메일을 먼저 입력해 주세요.', 'error')
      return
    }

    setSendingReset(true)

    const redirectTo = `${window.location.origin}/reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, { redirectTo })

    if (error) {
      showToast(error.message, 'error')
      setSendingReset(false)
      return
    }

    showToast(
      `${trimmedEmail}로 비밀번호 재설정 메일을 보냈습니다. 메일함(스팸 포함)을 확인해 주세요.`,
      'success',
    )
    setSendingReset(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary to-primary-700">
        <Spinner className="text-white" size="md" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary to-primary-700 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-primary">이러닝 번역기</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
              이메일
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="user@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="비밀번호"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || sendingReset}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
          >
            {submitting && <Spinner className="text-white" />}
            {submitting ? '처리 중...' : '로그인'}
          </button>

          <button
            type="button"
            onClick={handleForgotPassword}
            disabled={submitting || sendingReset}
            className="w-full text-center text-sm text-gray-500 transition-colors hover:text-accent disabled:opacity-50"
          >
            {sendingReset ? '재설정 메일 발송 중...' : '비밀번호를 잊으셨나요?'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-400">
          계정은 관리자가 등록합니다. 문의는 관리자에게 연락해 주세요.
        </p>
      </div>
    </div>
  )
}
