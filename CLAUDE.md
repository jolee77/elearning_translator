# elearning-translator 프로젝트

## 프로젝트 개요
한국어 이러닝 스토리보드(PPTX)를 베트남어로 번역하는 웹서비스.
설계담당자가 번역 프로세스를 진행하고, 외부 전문가가 검증하는 협업 시스템.

## 기술 스택
- Frontend: React 18 + Vite + TypeScript
- Styling: Tailwind CSS
- Backend: Supabase (Auth + DB + Storage)
- AI: Claude API (claude-sonnet-4-6) — Supabase Edge Function에서 호출
- 배포: Vercel

## Supabase 설정
```
VITE_SUPABASE_URL=https://jprclgxtaxksocxeqoze.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwcmNsZ3h0YXhrc29jeGVxb3plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODYwMzIsImV4cCI6MjA5Nzc2MjAzMn0.bYn3QQ82sNF4MXmnU0gSLrcBWMPEK3bA1B7HVAu7n_Y
```

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
- `screen_text` (JSONB), `screen_desc`, `image_nums` (`image_num` 아님), `narration`, `created_at`

### spelling_results
- `id`, `project_id`, `slide_id`, `field`, `original`, `suggestion`, `applied`, `created_at`

### translations
- `id`, `project_id`, `slide_id`, `field`, `source` (한국어), `vi_text`, `cpm`, `vi_wpm`, `created_at`, `updated_at`

### verifications
- `id`, `project_id`, `slide_id`, `translation_id`, `back_translation`, `score`, `issues`, `apply_status`, `created_at`

### expert_reviews
- `id`, `project_id`, `token`, `status`, `expert_name`, `expert_email`, `message`, `created_at`

### expert_review_items
- `id`, `expert_review_id`, `slide_id`, `field`, `status`, `comment`, `created_at`
- 한국어/번역문은 `translations` 조인으로 표시 (`source`, `vi_text`)

### change_logs
- `id`, `project_id`, `user_id`, `action`, `detail`, `metadata`, `changed_at`

### Storage
- 버킷: `pptx-files`
- 경로: `{userId}/{projectId}/source.pptx`

## 프로젝트 status 흐름
uploaded → extracted → spelling → spelling_done → translating → translated → verifying → verified → expert_review → done

## 전체 화면 구조
```
/login                  로그인
/dashboard              프로젝트 목록 (설계담당자)
/projects/new           새 프로젝트 생성
/projects/:id           프로젝트 상세 (단계별 스텝)
  Step1: 추출 확인
  Step2: 맞춤법 검사 결과 + 수정 적용
  Step3: 번역 결과 확인
  Step4: 역번역 검증 결과 + 반영 여부 결정
  Step5: 전문가 검증 요청 (링크 생성)
  Step6: 완료 → 다운로드
/review/:token          전문가 검증 (로그인 없이 토큰으로 접속)
/admin/settings         관리자 - API 키 설정
/admin/users            관리자 - 사용자 관리
/admin/projects         관리자 - 전체 프로젝트 현황
```

## PPTX 파싱 로직 (중요)
실제 스토리보드 구조 기반 좌표값 (PLC 과정 실측):

```typescript
const SB_CX = 12192000  // 슬라이드 너비 EMU
const SB_CY = 6858000   // 슬라이드 높이 EMU

// 영역 판별 함수
isScreenNum:   x/CX > 0.79 && y/CY < 0.12 && w/CX < 0.20  // 화면번호
isCourseName:  x/CX > 0.10 && x/CX < 0.50 && y/CY >= 0.04 && y/CY < 0.08
isChapterName: x/CX > 0.10 && x/CX < 0.35 && y/CY >= 0.08 && y/CY < 0.15
isMenu:        x/CX < 0.25 && y/CY >= 0.08 && y/CY < 0.78  // 좌측 목차
isScreen:      x/CX >= 0.13 && x/CX < 0.75 && y/CY >= 0.08 && y/CY < 0.78
isScreenDesc:  x/CX >= 0.75 && y/CY < 0.63   // 우측 화면설명
isImageNum:    x/CX >= 0.75 && y/CY >= 0.63 && y/CY < 0.78
isNarration:   y/CY >= 0.78                   // 하단 나레이션
```

슬라이드 타입 분류:
- guide: slideNum <= 9 (가이드 슬라이드, 처리 제외)
- intro: 화면번호에 'INTRO' 또는 '01' 패턴
- divider: '간지' 포함
- outro: 'OUTRO' 또는 '아웃트로'
- quiz: '문제풀기'
- apply: '적용하기'
- lesson: 화면번호 xx_xx 패턴
- content: 나머지

## VN PPTX 생성 로직 (중요)
KO PPTX를 기반으로 번역 박스를 추가하는 방식.
기존 한글 텍스트 박스는 건드리지 않고, 아래에 새 박스를 삽입.

### 나레이션 박스 처리
기존 VN PPTX 참고: NARR_BOX 단일 박스 안에
[한글(ko)]\n원문\n\n[베트남어(vi)]\n번역문 형태로 구성

새 박스 스펙:
- 배경색: C3D69B (연두)
- 테두리: FF0000 (빨강)
- 폰트: sz=1200, lang=vi-VN, altLang=ko-KR
- 텍스트색: 0033CC (파란색)
- 위치: 원본 나레이션 박스 y + h + 50000 EMU

### 화면 텍스트 박스 처리
각 한글 텍스트 박스 하단에 새 텍스트 박스 추가:
- 위치: 원본 박스 x, y + h + 30000 EMU
- 크기: 원본 박스와 동일한 w, h는 spAutoFit
- 배경: 없음 (투명)
- 폰트: sz=원본동일, lang=vi-VN, color=0033CC

번역 대상 텍스트 박스 조건:
- 가이드/배경 슬라이드 제외 (slideNum <= 9)
- #숫자 만 있는 박스 제외
- 빈 박스 제외
- 과정명/회차명 등 고정 UI 제외 (y/CY < 0.05)

## Claude API 호출 방식
Supabase Edge Function에서 처리 (API 키 서버사이드 보관)

엔드포인트:
- /functions/v1/spelling-check    맞춤법 검사
- /functions/v1/translate         번역 (배치: 3슬라이드씩)
- /functions/v1/verify            역번역 검증 (배치: 4슬라이드씩)
- /functions/v1/extract-glossary  용어 추출

각 함수에서 settings 테이블의 claude_api_key 조회 후 사용.

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
- expert_reviews 테이블에 token(hex 32bytes) 생성
- /review/:token URL을 설계담당자가 수동으로 전문가에게 공유
- 전문가는 로그인 없이 해당 URL로 접속
- get_expert_review_by_token(token) RPC로 데이터 조회
- save_expert_review_item(token, ...) RPC로 저장 (RLS 우회)
- 전문가가 모든 항목 완료 시 expert_reviews.status = 'done'
- projects.status = 'done' 으로 자동 업데이트

## 산출물 생성
1. VN PPTX: KO PPTX + 번역 박스 삽입 (JSZip으로 브라우저에서 처리)
2. 엑셀: 국문-베트남어 시트 형식 (SheetJS)
   - 컬럼: 구분 | 한글(ko) | 베트남어(vi) | | | 비고
   - 슬라이드번호 행 + 하위 텍스트 행들
3. 변경이력: change_logs 테이블 기반 XLSX

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
- primary: `#162B52` (네이비)
- accent: `#4B40E0` (인디고)
- Tailwind 설정: `tailwind.config.js` + `src/index.css`

## 구현 현황

### 완료
- [x] Tailwind CSS, Supabase Auth, 라우팅, Layout
- [x] PPTX 업로드 → 파싱 → slides 저장 (`pptxParser`, `useSlides`, ExtractionStep)
- [x] Edge Function (맞춤법, 번역, 역번역, 용어 추출)
- [x] 전문가 검증 (토큰 기반 UI + RPC)
- [x] VN PPTX 생성 + 엑셀 산출물 (`pptxGenerator`, `xlsxGenerator`, DoneStep)
- [x] 관리자 설정/사용자/프로젝트 화면
- [x] DB 컬럼명 Supabase 스키마와 통일

### 미구현 / 개선
- [ ] 공통 UI 컴포넌트 리팩터 (Button, Card, Badge 등)
- [ ] `01_schema.sql` 레포에 DDL 문서화

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
