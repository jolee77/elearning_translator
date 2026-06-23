import { useParams } from 'react-router-dom'

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900">프로젝트 상세</h2>
      <p className="mt-2 text-sm text-gray-500">프로젝트 ID: {id}</p>
    </div>
  )
}
