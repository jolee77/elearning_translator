import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { AiJobBanner } from './AiJobBanner'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `nb-sidebar-link${isActive ? ' nb-sidebar-link--active' : ''}`

export function Layout() {
  const { profile, signOut } = useAuth()
  const isAdmin = profile?.role === 'admin'

  return (
    <div className="nb-layout">
      <aside className="nb-sidebar">
        <div className="nb-sidebar-brand">
          <h1>이러닝 번역기</h1>
          <p>PPTX 번역 시스템</p>
        </div>

        <nav className="nb-sidebar-nav space-y-1">
          <NavLink to="/dashboard" className={navLinkClass}>
            <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </svg>
            대시보드
          </NavLink>

          <NavLink to="/projects/new" className={navLinkClass}>
            <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            새 프로젝트
          </NavLink>

          {isAdmin && (
            <>
              <p className="nb-sidebar-section">관리자</p>

              <NavLink to="/admin/settings" className={navLinkClass}>
                <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                API 설정
              </NavLink>

              <NavLink to="/admin/users" className={navLinkClass}>
                <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
                사용자 관리
              </NavLink>

              <NavLink to="/admin/projects" className={navLinkClass}>
                <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                전체 프로젝트
              </NavLink>
            </>
          )}
        </nav>
      </aside>

      <div className="nb-main">
        <header className="nb-header">
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{profile?.name ?? '사용자'}</p>
              <p className="text-xs text-gray-500">
                {profile?.role === 'admin' ? '관리자' : '설계담당자'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => signOut()}
              className="nb-btn-secondary py-1.5 text-sm"
            >
              로그아웃
            </button>
          </div>
        </header>

        <AiJobBanner />

        <main className="nb-content nb-app-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
