import { Link } from 'react-router-dom'

export function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-12">
      <div>
        <h1 className="text-2xl font-bold text-[#162B52]">도움말</h1>
        <p className="mt-2 text-sm text-gray-600">
          이러닝 스토리보드(PPTX)를 목적 언어로 번역·검증하는 전체 절차와 편의 기능을 안내합니다.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#162B52]">이용 프로세스 (6단계)</h2>
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-gray-800">
          <li>
            <strong>추출 확인</strong> — PPTX를 업로드하면 화면 텍스트·나레이션을 자동 추출합니다.
            내용을 확인·수정한 뒤 추출을 완료합니다.
          </li>
          <li>
            <strong>맞춤법 검사</strong> — AI가 한글 오타·띄어쓰기만 최소 교정합니다(문장 재작성 없음). 변경·제외를 선택한 뒤
            슬라이드에 반영하고 「검토 완료」로 다음 단계로 진행합니다.
          </li>
          <li>
            <strong>번역 대상 선택</strong> — 번역할 슬라이드·텍스트만 남기고 불필요한 항목은 제외합니다.
            여기서 제외한 내용은 이후 번역·전문가 검증에도 포함되지 않습니다.
          </li>
          <li>
            <strong>번역·역번역 검증</strong> — AI 번역 후 역번역으로 의미를 점검합니다.
            번역문을 직접 수정·저장할 수 있습니다.
          </li>
          <li>
            <strong>전문가 검증</strong> — 공유 링크를 생성해 외부 전문가에게 보냅니다.
            전문가는 로그인 없이 링크에서 최종 번역을 검토·수정합니다.
            맞춤법 반영 원문 팝업·원본 PPTX 다운로드로 맥락을 확인할 수 있습니다.
          </li>
          <li>
            <strong>완료·다운로드</strong> — VN PPTX, 번역 엑셀, 변경이력이 포함된 ZIP을 내려받습니다.
            파일명은 업로드 원본명에 <code className="rounded bg-gray-100 px-1">_VN</code>이 붙습니다.
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#162B52]">주요 기능</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-gray-800">
          <li>
            <strong>PPTX 파싱</strong> — 화면 영역 텍스트·나레이션·좌측 상단 부제목을 추출합니다.
            목차·과정명·화면번호 등 UI 라벨은 번역 대상에서 제외됩니다.
          </li>
          <li>
            <strong>AI 맞춤법·번역·역번역</strong> — Claude API를 서버(Edge Function)에서 호출하며,
            API 키는 관리자 설정에 보관됩니다.
          </li>
          <li>
            <strong>반복 제목 처리</strong> — 여러 화면에 같은 제목/부제목이 반복되면, 처음 등장한
            화면에서 수정한 번역이 VN PPTX에 동일하게 반영됩니다.
          </li>
          <li>
            <strong>산출물</strong> — VN PPTX는 원본 한글 박스 아래에 번역 박스를 붙입니다.
            엑셀은 A4 가로 기준 열 너비·줄바꿈이 적용됩니다.
          </li>
          <li>
            <strong>전문가 검증</strong> — 원문 → 1차 번역 → 역번역 → 최종 번역 순으로 검토하며,
            제출 전 「다시 수정」으로 항목을 되돌릴 수 있습니다. 「맞춤법 반영 원문 보기」팝업으로
            슬라이드 전체 한국어를 참고하고, 「원본 PPTX 다운로드」로 레이아웃을 확인할 수 있습니다.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#162B52]">편의 기능</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-gray-800">
          <li>
            <strong>작업 중 다른 메뉴 이동</strong> — 맞춤법·번역·역번역 실행 중에도 대시보드나
            다른 프로젝트·단계로 이동할 수 있습니다. 상단 배너로 진행 상황을 확인하고,
            배치가 끝날 때마다 결과가 화면에 갱신됩니다.
          </li>
          <li>
            <strong>주의</strong> — 브라우저 새로고침이나 탭을 닫으면 진행 중인 AI 작업은 중단됩니다.
            작업이 끝날 때까지 탭을 유지해 주세요.
          </li>
          <li>
            <strong>슬라이드 접기</strong> — 맞춤법·번역 단계에서 슬라이드 단위로 목록을 접어
            필요한 항목만 볼 수 있습니다.
          </li>
          <li>
            <strong>제외 선택</strong> — Step 3에서 슬라이드·텍스트 단위로 제외하면 번역·엑셀·전문가
            검증에서 한꺼번에 빠집니다.
          </li>
          <li>
            <strong>비밀번호 재설정</strong> — 로그인 화면의 「비밀번호를 잊으셨나요?」에서
            재설정 메일을 받을 수 있습니다.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#162B52]">관리자</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-gray-800">
          <li>API 설정 — Claude API 키·기본 목적 언어</li>
          <li>사용자 관리 — 설계담당자·관리자 등록 및 정보 수정</li>
          <li>전체 프로젝트 — 현황 조회·삭제</li>
        </ul>
      </section>

      <div className="pt-2">
        <Link to="/dashboard" className="nb-btn-secondary inline-flex text-sm">
          대시보드로 돌아가기
        </Link>
      </div>
    </div>
  )
}
