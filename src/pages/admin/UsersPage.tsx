import { useState, type FormEvent } from 'react'
import { useAuth } from '../../hooks/useAuth'
import {
  useInviteUser,
  useProfiles,
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
  const inviteUser = useInviteUser()
  const { showToast } = useToast()

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [showInviteForm, setShowInviteForm] = useState(false)

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

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault()

    try {
      await inviteUser.mutateAsync({ email: inviteEmail, name: inviteName })
      setInviteEmail('')
      setInviteName('')
      setShowInviteForm(false)
      showToast('초대 이메일이 발송되었습니다.', 'success')
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : '사용자 초대에 실패했습니다.',
        'error',
      )
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">사용자 관리</h2>
          <p className="mt-1 text-sm text-gray-500">
            사용자 목록 조회, 역할 변경, 신규 사용자 초대
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowInviteForm((v) => !v)}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-600"
        >
          {showInviteForm ? '초대 취소' : '사용자 초대'}
        </button>
      </div>

      {showInviteForm && (
        <form
          onSubmit={handleInvite}
          className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h3 className="mb-4 text-sm font-semibold text-gray-900">신규 사용자 초대</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="inviteName" className="mb-1 block text-sm font-medium text-gray-700">
                이름
              </label>
              <input
                id="inviteName"
                type="text"
                required
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                placeholder="홍길동"
              />
            </div>
            <div>
              <label htmlFor="inviteEmail" className="mb-1 block text-sm font-medium text-gray-700">
                이메일
              </label>
              <input
                id="inviteEmail"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                placeholder="user@example.com"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={inviteUser.isPending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
            >
              {inviteUser.isPending ? '초대 중...' : '초대 이메일 발송'}
            </button>
          </div>
        </form>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-gray-500">사용자 목록을 불러오는 중...</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          사용자 목록을 불러오지 못했습니다: {error.message}
        </div>
      )}

      {profiles && profiles.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  이름
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  이메일
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  역할
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  가입일
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {profiles.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    {user.name}
                    {user.id === currentProfile?.id && (
                      <span className="ml-2 text-xs text-gray-400">(나)</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                    {user.email}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {user.id === currentProfile?.id ? (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        {ROLE_LABELS[user.role]}
                      </span>
                    ) : (
                      <select
                        value={user.role}
                        onChange={(e) =>
                          handleRoleChange(user.id, e.target.value as UserRole)
                        }
                        disabled={updateRole.isPending}
                        className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      >
                        <option value="designer">{ROLE_LABELS.designer}</option>
                        <option value="admin">{ROLE_LABELS.admin}</option>
                      </select>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {formatDate(user.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {profiles && profiles.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
          <p className="text-sm text-gray-500">등록된 사용자가 없습니다.</p>
        </div>
      )}
    </div>
  )
}
