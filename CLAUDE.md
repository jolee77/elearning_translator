# elearning-translator 프로젝트

## 프로젝트 개요
한국어 이러닝 스토리보드(PPTX)를 베트남어로 번역하는 웹서비스.
설계담당자가 번역 프로세스를 진행하고, 외부 전문가가 검증하는 협업 시스템.

## 기술 스택
- Frontend: React 18 + Vite + TypeScript
- Styling: Tailwind CSS v4
- Backend: Supabase (Auth + DB + Storage + Edge Functions / Deno)
- AI: Claude API (claude-sonnet-4-6) — Supabase Edge Function에서 호출
- 배포: Vercel (Frontend), Supabase (DB·Edge Functions)

## 개발 정보 (시스템 등록용)

| 필드 | 값 |
|------|-----|
| Frontend | `React, TypeScript, Vite, Tailwind CSS, React Query, React Router` |
| Backend | `Supabase Edge Functions, Supabase Auth, Supabase Storage` |
| Database | `PostgreSQL` |
| DB 종류 | `PostgreSQL (Supabase)` |
| DB Host | `aws-1-ap-northeast-2.pooler.supabase.com` |
| DB Name | `postgres` |

- Node.js/Express, Redis 미사용
- Supabase 프로젝트 ref: `jprclgxtaxksocxeqoze` (리전: ap-northeast-2)
- 프로덕션 URL: https://elearning-translator.vercel.app

## Supabase 설정
```
VITE_SUPABASE_URL=https://jprclgxtaxksocxeqoze.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwcmNsZ3h0YXhrc29jeGVxb3plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODYwMzIsImV4cCI6MjA5Nzc2MjAzMn0.bYn3QQ82sNF4MXmnU0gSLrcBWMPEK3bA1B7HVAu7n_Y
```

## 로컬 개발 시 로그인

- Vercel과 **localhost는 세션(localStorage)이 공유되지 않습니다.** 로컬에서도 별도로 로그인해야 합니다.
- `.env`는 `elearning-translator` 폴더에 두고, **수정 후 dev 서버를 재시작**하세요.
- 비밀번호 오류 시 토스트: 「이메일 또는 비밀번호가 올바르지 않습니다」
- 로그인 화면 「비밀번호를 잊으셨나요?」→ `/reset-password` 재설정 메일 발송
- Supabase Redirect URLs에 `https://elearning-translator.vercel.app/**`, `http://localhost:5173/**` 등록 필요

## DB 테이블 구조

> 컬럼명은 `src/types/index.ts` 및 Supabase 실제 스키마와 동일해야 함.  
> 코드에서 임의 명명 금지 (예: `ko_pptx_path`, `menu_text`, `image_num`, `ko_text` 등 사용하지 않음).

### profiles
- `id`, `email`, `name`, `role` (admin | designer), `created_at`, `updated_at`

### settings (key-value)
- `id`, `key`, `value` — `claude_api_key`, `default_target_lang` 등은 row로 저장

### projects
- `id`, `created_by`, `title`, `status`, `source_pptx_url`, `source_pptx_name`, `vn_pptx`, `target_lang`, `created_at`, `updated_at`

### slides
- `id`, `project_id`, `slide_num`, `slide_type`, `screen_num`, `course_name`, `chapter_name`
- `current_section` (목차 — `menu_text` 아님)
- `screen_text` (text — JSON 문자열), `screen_desc`, `image_nums` (`image_num` 아님), `narration`, `created_at`
- `exclude_from_translation` (boolean, 기본 false) — Step3에서 번역 제외 선택한 슬라이드

### spelling_results
- `id`, `project_id`, `slide_id`, `field`, `original`, `suggestion`, `applied`, `skipped`, `committed_to_slide`, `issues`, `created_at`
- `applied` = 검토 시 「변경」선택 (슬라이드 미반영), `skipped` = 「제외」, `committed_to_slide` = 슬라이드 일괄 반영 완료

### translations
- `id`, `project_id`, `slide_id`, `field`, `source` (한국어), `vi_text`, `cpm`, `vi_wpm`, `created_at`, `updated_at`
- `exclude_from_expert_review` (boolean, 기본 false) — Step4에서 전문가 검증 제외 선택

### verifications
- `id`, `project_id`, `slide_id`, `translation_id`, `back_translation`, `score`, `issues`, `apply_status`, `created_at`

### expert_reviews
- `id`, `project_id`, `token`, `status`, `expert_name`, `expert_email`, `message`, `created_at`

### expert_review_items
- `id`, `expert_review_id`, `slide_id`, `field`, `status`, `comment`, `original_vi_text`, `created_at`
- `status`: `pending` | `reviewed` (승인/수정완료 구분 없음)
- 한국어/번역문은 `translations` 조인 (`source`, `vi_text`), 역번역은 `verifications` 조인

### change_logs
- `id`, `project_id`, `user_id`, `action`, `detail`, `metadata`, `changed_at`
- 필드 단위 변경: `slide_id`, `stage` (spelling|translation|verification|expert_review), `field`, `before_value`, `after_value`

### Storage
- 버킷: `pptx-files`
- 경로: `{userId}/{projectId}/source.pptx`

## 프로젝트 status 흐름
uploaded → extracted → spelling → spelling_done → selection_done → translating → translated → verifying → verified → expert_review → done

> DB `status` 값은 그대로이며, UI는 6단계 (번역·역번역 검증 = Step 4).

## 전체 화면 구조
```
/login                  로그인
/dashboard              프로젝트 목록 (설계담당자)
/projects/new           새 프로젝트 생성
/projects/:id           프로젝트 상세 (단계별 스텝)
  Step1: 추출 확인
  Step2: 맞춤법 검사 — 슬라이드 접기·펼치기, 슬라이드 단위 일괄 선택, 변경·검토 필요 항목만 표시
  Step3: 번역 대상 선택 — 추출 내용 확인 후 exclude_from_translation으로 제외
  Step4: 번역·역번역 검증 (통합) — 항목·슬라이드별 전문가 검증 제외 가능
  Step5: 전문가 검증 요청 (링크 생성) + 검토 현황 표
  Step6: 완료 → 다운로드
/review/:token          전문가 검증 (로그인 없이 토큰, 역번역 포함)
/admin/settings         관리자 - API 키 설정
/admin/users            관리자 - 사용자 등록·정보 수정 (이름/이메일/비밀번호/역할)
/admin/projects         관리자 - 전체 프로젝트 현황 + 삭제
```

## PPTX 파싱 로직 (중요)

EMU: `SB_CX=12192000`, `SB_CY=6858000`.

### 텍스트 수집
- **레이아웃 + 슬라이드** XML만 병합 (`getMergedShapesForSlide`)
- **슬라이드 마스터** 텍스트(라벨·placeholder)는 추출·번역 **제외**
- `grpSp` 중첩 그룹 좌표 변환, `<a:br/>` 줄바꿈 유지

### 영역 분류 (겹침 51% 기준, `classifyShapeRegion`)
| 영역 | 대략적 범위 | 추출 |
|------|-------------|------|
| screen | x 13%~75%, y 8%~78% | 화면텍스트 |
| desc | x 58%~100%, y 8%~63% | 제외 |
| narration | y 54%~100% | 나레이션 (단일 박스 합침) |
| image_num | x 58%~100%, y 63%~78% | 제외 |
| menu | x 0%~25% | 제외 |
| header | 상단 과정명·회차명 등 | 제외 (화면번호만 `screen_num`) |
| screen_num | x 60%~82%, y 0%~12% | `screen_num` (`01-00`, `01_05` 등) |

desc/image_num은 screen과 영역이 겹침. **도형 중심이 화면 밴드(x 13~75%, y 8~78%) 안이고 screen 겹침이 51% 초과면 screen 우선** — 우측 전용 설명·이미지번호 패널(중심 x≥75%)만 제외.

마스터 도형은 **화면번호 판별에만** 사용. 본문 병합은 레이아웃+슬라이드.

### screen_text / narration 저장
- DB `slides.screen_text`, `slides.narration` → text 컬럼, JSON `SlideTextBox[]`
- `normalizeScreenText` / `normalizeNarration`, `formatScreenText` / `formatNarration`
- 나레이션: 스크립트 밴드(싱크 마커)와 하단 밴드가 동시에 잡히면 **단일 박스만 선택** (`selectPrimaryNarrationShape`), 줄 단위는 `#` 제거 후 중복 제거
- **싱크 마커**: 나레이션 `#1` `#2` 유지, `‹#›`·`<#>`·단독 `#` 제외 (`isBareSyncMarker`)
- 화면텍스트: `#N` 단독 박스·화면번호 패턴·게티/URL 메타데이터 제외

### 슬라이드 타입 (번호가 아닌 패턴)
intro / divider / outro / quiz / apply / lesson / content — ~~slideNum≤9 guide~~ **폐지**

### 좌표 없는 플레이스홀더 나레이션
- xfrm 없어도 `(0,0)` 수집 → `findFallbackNarrationShape` 보완
- `isDirectorNote`로 연출 지시 제외

## VN PPTX 생성 로직 (중요)
KO PPTX를 기반으로 번역 박스를 추가하는 방식.
기존 한글 텍스트 박스는 건드리지 않고, 아래에 새 박스를 삽입.

### 나레이션 박스 처리
기존 나레이션 박스를 **덮어쓰기** (추가 박스 생성하지 않음).
중복 나레이션 박스가 있으면 본문 키 기준으로 하나만 채우고 나머지는 비움.

내용 형식 (라벨 없음):
```
한글 맞춤법 반영본

베트남어 번역문
```

스타일:
- 배경색: C3D69B (연두)
- 테두리: FF0000 (빨강)
- 폰트: sz=1200, 한글 lang=ko-KR / 베트남어 lang=vi-VN color=0033CC

매칭: PPTX 원문 ↔ `translations.source` (공백 정규화) + `spelling_results` original→suggestion 연결

### 화면 텍스트 박스 처리
각 한글 텍스트 박스 하단에 새 텍스트 박스 추가:
- 위치: 원본 박스 x, y + h + 30000 EMU
- 크기: 원본 박스와 동일한 w, h는 spAutoFit
- 배경: 없음 (투명)
- 폰트: sz=원본동일, lang=vi-VN, color=0033CC
- 영역 판별: `overlapsScreenContent` (파서와 동일)

## Claude API 호출 방식
Supabase Edge Function에서 처리 (API 키 서버사이드 보관)

엔드포인트:
- /functions/v1/spelling-check    맞춤법 검사
- /functions/v1/translate         번역 (배치: 3슬라이드씩)
- /functions/v1/verify            역번역 검증 (배치: 4슬라이드씩)
- /functions/v1/extract-glossary  용어 추출

각 함수에서 settings 테이블의 claude_api_key 조회 후 사용.

### 백그라운드 실행 (앱 내 이동)
맞춤법·번역·역번역은 `AiJobProvider`가 클라이언트에서 배치 루프를 소유한다.
대시보드·다른 Step·다른 프로젝트로 이동해도 작업이 이어지며, Layout 상단 배너와 완료/실패 토스트로 알린다.
**배치가 끝날 때마다** React Query를 갱신해 부분 결과를 화면에 바로 표시한다.
브라우저 새로고침·탭 닫기 시에는 중단된다 (서버 작업 큐 없음).

## 언어별 발화속도 (CPM)
```typescript
const LANG_CONFIG = {
  vi: { name: '베트남어', wpm: 155 },
  en: { name: '영어', wpm: 150 },
  zh: { name: '중국어(간체)', wpm: 220 },
  ja: { name: '일본어', wpm: 400 },
  id: { name: '인도네시아어', wpm: 145 },
}
const KO_CPM = 320
```

## 전문가 검증 방식
- expert_reviews 테이블에 token(hex 32bytes) 생성 — `extensions.gen_random_bytes` 사용
- /review/:token URL을 설계담당자가 수동으로 전문가에게 공유
- 전문가는 로그인 없이 해당 URL로 접속
- 상세 패널 필드 순서: 한국어 원문 → 번역문(수정 가능) → 역번역
- 항목 「완료 → 다음」저장 시 다음 미검토 항목으로 자동 이동 (목록 스크롤 연동)
- 설계자 Step6 수정 건수: `useExpertReviewItems(reviewId, projectId)`로 translations 조인 필수 (`vi_text` vs `original_vi_text`)
- Step6 「변경 내역」: 맞춤법(committed) → 번역/역번역(change_logs before/after) → 전문가(original_vi_text) 전·후 (이벤트 이력과 분리)
- get_expert_review_by_token(token) RPC로 데이터 조회
- save_expert_review_item(token, ...) RPC로 저장 (RLS 우회)
- 전문가가 모든 항목 완료 시 expert_reviews.status = 'done'
- projects.status = 'done' 으로 자동 업데이트

## 산출물 생성
1. VN PPTX: KO PPTX + 번역 박스 삽입 (JSZip으로 브라우저에서 처리)
2. 엑셀: 국문-베트남어 시트 형식 (SheetJS)
   - 컬럼: 구분 | 유형 | 한글 | 목적언어(예: 베트남어)
   - 슬라이드번호 행 + 하위 텍스트 행들 (유형: 화면 텍스트 / 나레이션)
3. 변경이력: 단계 | 항목 | 수정자(설계자·전문가 이름) | 일시
   - PPTX 다운로드: `downloadBlob`은 object URL을 지연 revoke (큰 파일 다운로드 끊김 방지)

## 주요 라이브러리
```json
{
  "jszip": "^3.10.1",
  "xlsx": "^0.18.5",
  "@supabase/supabase-js": "^2.x",
  "@tanstack/react-query": "^5.x",
  "react-router-dom": "^7.x",
  "tailwindcss": "^4.x",
  "@tailwindcss/postcss": "^4.x"
}
```

## UI 테마
- primary: `#162B52` (네이비), accent: `#4B40E0` (인디고)
- nextBMS 스타일 유틸 클래스(`nb-*`) — `src/index.css`, `Layout.tsx`
- Tailwind 설정: `tailwind.config.js` + `src/index.css`

## 구현 현황 (2026-07-16)

### 완료
- [x] `projects_status_check`에 `selection_done` 추가 (번역 대상 선택 완료 실패 수정)
- [x] Step 2 맞춤법: 슬라이드 접기/펼치기 + 슬라이드 단위 선택(해당 슬라이드 추출 항목 일괄)
- [x] Step 4: 항목·슬라이드별 전문가 검증 제외 (`translations.exclude_from_expert_review`)
- [x] Step 3 번역 대상 선택: 추출 내용 확인·제외 체크·`selection_done` 후 번역 진행
- [x] `slides.exclude_from_translation` + 번역/엑셀에서 제외 슬라이드 필터
- [x] 맞춤법 Step 2: 이상 없음·검사 제외는 목록 숨김, 변경·검토·미반영만 표시
- [x] 맞춤법 결과 누락 슬라이드: 기존 검토 유지한 채 누락분만 재검사 / 무시하고 `spelling_done` 진행

## 구현 현황 (2026-07-10)

### 완료 (커밋·배포)
- [x] 나레이션 중복 추출 수정 — `selectPrimaryNarrationShape`, 줄 단위 정규화 dedupe
- [x] 맞춤법 Step 2: 변경·제외 검토 → 슬라이드 일괄 적용·되돌리기 (`committed_to_slide`)
- [x] 맞춤법 검사 완료는 사용자 「검토 완료」 시에만 `spelling_done`
- [x] DB 마이그레이션: `20250710100000_spelling_committed.sql`

## 구현 현황 (2026-06-24)

### 오늘 추가 완료 (저녁)
- [x] 사용자 등록: Edge Function 오류 메시지 표시 (`src/lib/edgeFunction.ts`)
- [x] 사용자 등록: 관리자 전체 프로필 조회 RLS (`20250624210000_profiles_admin_access.sql`)
- [x] 사용자 등록: 중복 이메일 시 프로필 복구 (`register-user` Edge Function)
- [x] 전문가 검증 링크: `extensions.gen_random_bytes` (`20250624200000_fix_gen_random_bytes.sql`)
- [x] 전문가 화면: 원문 → 번역문 → 역번역 순서

### 이번 작업에서 완료 (커밋됨, 배포됨)
- [x] PPTX 추출: 화면텍스트에서 싱크 마커(`#1`, `#2`…) 제외, 나레이션에는 유지 (`isSyncMarkerOnly`)
- [x] Step 3: 번역·역번역 검증 통합 (`TranslationVerificationStep`)
- [x] 전문가 검증: 승인/수정완료 버튼 제거 → 번역문+코멘트+완료 단일 저장
- [x] 전문가 화면: 슬라이드 표 + 클릭 상세, 원문 → 번역문 → 역번역 순서
- [x] 설계자 화면: 슬라이드 검토 현황 표 + 변경 항목 표시
- [x] 관리자: 프로젝트 삭제 (`admin_delete_project` RPC)
- [x] 관리자: 사용자 초대 → 등록 (`register-user` Edge Function, 역할 선택)
- [x] `AutoResizeTextarea` 컴포넌트
- [x] DB 마이그레이션: `20250624180000_workflow_updates.sql`
- [x] DB 마이그레이션: `20250624200000_fix_gen_random_bytes.sql`
- [x] DB 마이그레이션: `20250624210000_profiles_admin_access.sql`

### 저녁 배포 (완료)
- [x] Supabase: 마이그레이션 `20250624200000`, `20250624210000` 적용
- [x] Supabase: `register-user` Edge Function 재배포
- [x] Vercel 배포: `main` 푸시 완료

### 이전 배포 항목
- [x] Supabase: 마이그레이션 `20250624180000` 적용 (`supabase db push` 또는 SQL 실행)
- [x] Supabase: `register-user` Edge Function 최초 배포
- [x] nextBMS 디자인: `index.css`에 `nb-*` 유틸 클래스 추가, `Layout.tsx` 등 전역 스타일 반영
- [x] 기존 `VerificationStep.tsx` / `TranslationStep.tsx` 정리 (미사용 시 제거)

### 완료 (이전)
- [x] Tailwind CSS, Supabase Auth, 라우팅, Layout
- [x] PPTX 업로드 → 파싱 → slides 저장
- [x] Edge Function (맞춤법, 번역, 역번역, 용어 추출)
- [x] 전문가 검증 (토큰 기반 UI + RPC)
- [x] VN PPTX 생성 + 엑셀 산출물
- [x] 관리자 설정/사용자/프로젝트 화면
- [x] DB 컬럼명 Supabase 스키마와 통일

### 미구현 / 개선
- [ ] 공통 UI 컴포넌트 리팩터 (Button, Card, Badge 등)
- [ ] `01_schema.sql` 레포에 DDL 문서화

## 작업 예정 목록

향후 구현할 기능·개선 사항. 배포·운영과 별도로 순차 진행.

| 우선순위 | 항목 | 설명 |
|---------|------|------|
| — | ~~**전문가 검토 되돌리기**~~ | 완료 — 검토 완료 항목에「다시 수정」버튼으로 `pending` 복원 |
| — | ~~nextBMS 디자인 전역 적용~~ | 완료 — 로그인·대시보드·설정·스텝 컴포넌트 `nb-*` 통일 |
| — | 미사용 Step 컴포넌트 정리 | ~~`VerificationStep.tsx`, `TranslationStep.tsx`~~ 완료 |

## 폴더 구조
```
src/
  components/
    auth/           ProtectedRoute, AdminRoute
    layout/         Layout (사이드바 + 헤더 통합)
    ui/             Button, Card, Badge, Table, Modal 등 공통 컴포넌트 (미구현)
    project/        ProjectCard, StatusBadge, StepNav (미구현)
    spelling/       SpellingResultItem, ApplyButton (미구현)
    translation/    TranslationCompare, SpeedBadge (미구현)
    verification/   VerifyItem, ApplyStatusButtons (미구현)
    expert/         ExpertReviewItem, CommentBox (미구현)
  pages/
    LoginPage.tsx           ✅
    DashboardPage.tsx       스텁
    NewProjectPage.tsx      스텁
    ProjectDetailPage.tsx   스텁
    ExpertReviewPage.tsx    스텁
    admin/
      SettingsPage.tsx      스텁
      UsersPage.tsx         스텁
      ProjectsPage.tsx      스텁
  hooks/
    useAuth.ts              ✅
    AuthProvider.tsx        ✅
    useProject.ts           (미구현)
    useSlides.ts            (미구현)
    useSpelling.ts          (미구현)
    useTranslation.ts       (미구현)
    useVerification.ts      (미구현)
    useExpertReview.ts      (미구현)
  lib/
    supabase.ts             ✅
    pptxParser.ts           (미구현)
    pptxGenerator.ts        (미구현)
    xlsxGenerator.ts        (미구현)
    claudeApi.ts            (미구현)
  types/
    index.ts                ✅
```

## 개발 우선순위
1. ~~기반: Supabase 연동, Auth, 라우팅~~ ✅
2. 핵심: PPTX 업로드 → 파싱 → slides 저장
3. AI: Edge Function (맞춤법, 번역, 역번역)
4. 전문가: 토큰 기반 검증 화면
5. 산출물: VN PPTX 생성 + 엑셀
6. 관리자: 설정 화면

## 코딩 컨벤션
- TypeScript strict mode
- 컴포넌트: 함수형, named export
- 상태관리: React Query (Supabase 쿼리) + useState (로컬)
- 에러처리: try/catch, toast 알림
- 로딩: 각 단계별 progress bar
- 한국어 UI (모든 텍스트)
