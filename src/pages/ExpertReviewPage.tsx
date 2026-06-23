import { useParams } from 'react-router-dom'

export function ExpertReviewPage() {
  const { token } = useParams<{ token: string }>()

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-2xl rounded-xl bg-white p-8 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-900">전문가 검증</h2>
        <p className="mt-2 text-sm text-gray-500">토큰: {token}</p>
      </div>
    </div>
  )
}
