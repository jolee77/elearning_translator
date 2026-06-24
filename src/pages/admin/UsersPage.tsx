import { useState, type FormEvent } from 'react'
import { useAuth } from '../../hooks/useAuth'
import {
  useProfiles,
  useRegisterUser,
  useUpdateProfileRole,
} from '../../hooks/useAdmin'
import { useToast } from '../../hooks/ToastProvider'
import type { UserRole } from '../../types'

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: '관리자',
  designer: '설계담당자',
}

export function UsersPage() {
  const { profile: currentProfile } = useAuth()
  const { data: profiles, isLoading, error } = useProfiles()
  const updateRole = useUpdateProfileRole()
  const registerUser = useRegisterUser()
  const { showToast } = useToast()

  const [registerEmail, setRegisterEmail] = useState('')
  const [registerName, setRegisterName] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerRole, setRegisterRole] = useState<UserRole>('designer')
  const [showRegisterForm, setShowRegisterForm] = useState(false)

  const handleRoleChange = async (id: string, role: UserRole) => {
    if (id === currentProfile?.id) {
      showToast('자신의 역할은 변경할 수 없습니다.', 'error')
      return
    }

    try {
      await updateRole.mutateAsync({ id, role })
      showToast('역할이 변경되었습니다.', 'success')
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : '역할 변경에 실패했습니다.',
        'error',
      )
    }
  }

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault()

    try {
      await registerUser.mutateAsync({
        email: registerEmail,
        name: registerName,
        password: registerPassword,
        role: registerRole,
      })
      setRegisterEmail('')
      setRegisterName('')
      setRegisterPassword('')
      setRegisterRole('designer')
      setShowRegisterForm(false)
      showToast('사용자가 등록되었습니다.', 'success')
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : '사용자 등록에 실패했습니다.',
        'error',
      )
    }
  }

  return (
    <div>
      <div className="nb-page-toolbar">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">사용자 관리</h2>
          <p className="mt-1 text-sm text-gray-500">
            사용자 등록, 목록 조회, 역할 변경
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowRegisterForm((v) => !v)}
          className="nb-btn-primary"
        >
          {showRegisterForm ? '등록 취소' : '사용자 등록'}
        </button>
      </div>

      {showRegisterForm && (
        <form onSubmit={handleRegister} className="nb-card nb-input-surface mb-6 p-6">
          <h3 className="mb-4 text-sm font-semibold" style={{ color: '#0958d9' }}>
            신규 사용자 등록
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="registerName" className="nb-field-label">
                이름
              </label>
              <input
                id="registerName"
                type="text"
                required
                value={registerName}
                onChange={(e) => setRegisterName(e.target.value)}
                className="nb-input mt-1 w-full"
                placeholder="홍길동"
              />
            </div>
            <div>
              <label htmlFor="registerEmail" className="nb-field-label">
                이메일
              </label>
              <input
                id="registerEmail"
                type="email"
                required
                value={registerEmail}
                onChange={(e) => setRegisterEmail(e.target.value)}
                className="nb-input mt-1 w-full"
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label htmlFor="registerPassword" className="nb-field-label">
                초기 비밀번호
              </label>
              <input
                id="registerPassword"
                type="password"
                required
                minLength={8}
                value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)}
                className="nb-input mt-1 w-full"
                placeholder="8자 이상"
              />
            </div>
            <div>
              <label htmlFor="registerRole" className="nb-field-label">
                역할
              </label>
              <select
                id="registerRole"
                value={registerRole}
                onChange={(e) => setRegisterRole(e.target.value as UserRole)}
                className="nb-input mt-1 w-full"
              >
                <option value="designer">{ROLE_LABELS.designer}</option>
                <option value="admin">{ROLE_LABELS.admin}</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={registerUser.isPending}
              className="nb-btn-primary"
            >
              {registerUser.isPending ? '등록 중...' : '사용자 등록'}
            </button>
          </div>
        </form>
      )}

      {isLoading && (
        <div className="nb-empty-state">
          <p className="text-sm text-gray-500">사용자 목록을 불러오는 중...</p>
        </div>
      )}

      {error && (
        <div className="nb-alert nb-alert--error">
          사용자 목록을 불러오지 못했습니다: {error.message}
        </div>
      )}

      {profiles && profiles.length > 0 && (
        <div className="nb-card overflow-hidden">
          <table className="nb-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th>역할</th>
                <th>가입일</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((user) => (
                <tr key={user.id}>
                  <td className="font-medium text-gray-900">
                    {user.name}
                    {user.id === currentProfile?.id && (
                      <span className="ml-2 text-xs text-gray-400">(나)</span>
                    )}
                  </td>
                  <td>{user.email}</td>
                  <td>
                    {user.id === currentProfile?.id ? (
                      <span className="nb-badge">{ROLE_LABELS[user.role]}</span>
                    ) : (
                      <select
                        value={user.role}
                        onChange={(e) =>
                          handleRoleChange(user.id, e.target.value as UserRole)
                        }
                        disabled={updateRole.isPending}
                        className="nb-input text-sm"
                      >
                        <option value="designer">{ROLE_LABELS.designer}</option>
                        <option value="admin">{ROLE_LABELS.admin}</option>
                      </select>
                    )}
                  </td>
                  <td className="text-gray-500">{formatDate(user.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {profiles && profiles.length === 0 && (
        <div className="nb-empty-state">
          <p className="text-sm text-gray-500">등록된 사용자가 없습니다.</p>
        </div>
      )}
    </div>
  )
}
