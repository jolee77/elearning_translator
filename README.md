# elearning-translator

한국어 이러닝 스토리보드(PPTX)를 베트남어로 번역하는 웹서비스.

## 기술 스택

- React 18 + Vite + TypeScript
- Tailwind CSS v4
- Supabase (Auth, DB, Storage, Edge Functions)
- React Query + React Router
- Claude API (Supabase Edge Function 경유)

## 개발 정보

| 항목 | 내용 |
|------|------|
| **Frontend** | React, TypeScript, Vite, Tailwind CSS, React Query, React Router |
| **Backend** | Supabase Edge Functions (Deno), Supabase Auth, Supabase Storage |
| **Database** | PostgreSQL (Supabase 관리형) |
| **DB 종류** | PostgreSQL 15 (Supabase) |
| **DB Host** | `aws-1-ap-northeast-2.pooler.supabase.com` |
| **DB Name** | `postgres` |
| **배포 (Frontend)** | Vercel — [elearning-translator.vercel.app](https://elearning-translator.vercel.app) |
| **배포 (Backend/DB)** | Supabase — 프로젝트 `jprclgxtaxksocxeqoze` (ap-northeast-2) |
| **AI** | Claude API (`claude-sonnet-4-6`) — Edge Function에서 서버 호출 |
| **저장소** | Supabase Storage (`pptx-files` 버킷) |
| **원격 저장소** | `https://github.com/jolee77/elearning_translator.git` |

> **참고:** 별도 Node.js/Express 서버·Redis는 사용하지 않습니다. API·인증·DB는 Supabase가 담당합니다.

## 시작하기

```bash
# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env
# .env에 Supabase URL·anon key 입력 후 dev 서버 재시작 (이미 띄운 경우 Ctrl+C 후 npm run dev)

VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key

# 개발 서버
npm run dev

# 프로덕션 빌드
npm run build
```

## 주요 라우트

| 경로 | 설명 |
|------|------|
| `/login` | 로그인 |
| `/dashboard` | 프로젝트 목록 |
| `/projects/new` | 새 프로젝트 |
| `/projects/:id` | 프로젝트 상세 |
| `/review/:token` | 전문가 검증 (토큰) |
| `/admin/*` | 관리자 (admin 전용) |

## 문서

프로젝트 상세 스펙은 [CLAUDE.md](./CLAUDE.md)를 참고하세요.

## 최근 수정 (2026-07-16)

### 번역 대상 선택 (Step 3)
- 맞춤법 완료 후·번역 전에 추출 내용(화면텍스트·나레이션)을 확인하고 제외 슬라이드 선택
- DB: `slides.exclude_from_translation`, 프로젝트 상태 `selection_done`
- UI 6단계: 추출 → 맞춤법 → **대상 선택** → 번역·역번역 → 전문가 → 완료
- 번역·엑셀 산출물에서 제외 슬라이드 필터 (`isTranslateEligibleSlide`)

### 맞춤법·전문가 제외 UX (2026-07-16)
- Step 2: 슬라이드 접기/펼치기, 슬라이드 체크 시 해당 슬라이드 검토 대기 항목 일괄 선택
- Step 3: 슬라이드·텍스트 단위 제외 (`exclude_from_translation` + `excluded_fields`) — 번역·전문가 검증에 공통
- Step 4: 제외 선택 UI 없음 (Step 3 결과만 사용)

DB 마이그레이션:
- `supabase/migrations/20260716140000_slides_exclude_from_translation.sql`
- `supabase/migrations/20260716150000_exclude_from_expert_review.sql`
- `supabase/migrations/20260716160000_projects_status_selection_done.sql`
- `supabase/migrations/20260716170000_slides_excluded_fields.sql`

## 최근 수정 (2026-07-10)

### PPTX 파서 v2 이식
- **1~9장 가이드 강제 제외 폐지** — 화면번호·본문 패턴으로 intro/divider/lesson 등 분류
- **레이아웃+슬라이드 병합**, 영역 겹침 **51%** 기준 분류
- **마스터는 화면번호만** — 상단 `01-00` 등은 `screen_num`, 과정명·목차·화면설명·이미지번호는 제외
- **나레이션 단일 박스** — 스크립트 밴드(싱크 마커)와 하단 밴드가 동시에 잡히면 **단일 박스만 선택** (`selectPrimaryNarrationShape`), 줄 단위 `#` 제거 후 중복 제거
- **싱크 마커** — `#1`, `#2` 등 숫자 포함만 유지, `‹#›`·`<#>`·단독 `#` 제외
- **메타데이터 제외** — 게티/Getty 이미지번호, URL 등 비번역 텍스트 필터
- Step 1 UI: 화면텍스트·나레이션 열 너비 **2:3**
- Edge Function `_shared/slides.ts`: `formatNarration` / `normalizeNarration` 반영

> 기존 프로젝트는 Step 1 **「다시 추출」** 필요.

### 맞춤법 검사 워크플로우 (Step 2)
1. AI 검사 — 추출 텍스트만 검사, 슬라이드는 변경하지 않음
2. **변경** / **제외** — `spelling_results.applied` / `skipped`만 갱신
3. **슬라이드에 일괄 적용** / **적용 되돌리기** — `committed_to_slide`로 반영·복원 (`original` 기준)
4. **검토 완료 → 대상 선택** — 변경 항목이 모두 슬라이드에 반영된 뒤 Step 3으로 진행

DB 마이그레이션: `supabase/migrations/20250710100000_spelling_committed.sql` (`committed_to_slide` 컬럼)

## 최근 수정 (2026-06-24)

### 버그 수정·운영
- **사용자 등록**: Edge Function 오류 메시지 실제 내용 표시 (`invokeEdgeFunction` 공통화)
- **사용자 등록**: 관리자 `profiles` RLS 추가 — 전체 회원 목록 조회·역할 변경 가능
- **사용자 등록**: 이미 auth에만 있는 이메일은 프로필 복구·비밀번호 갱신 후 등록 완료
- **전문가 검증 링크**: `extensions.gen_random_bytes` 사용 (토큰 생성 오류 수정)
- **전문가 화면**: 필드 순서 — 한국어 원문 → 번역문 → 역번역

### 워크플로·기능
- **5단계 UI**: 번역·역번역 검증 Step 3 통합 (`TranslationVerificationStep`)
- **싱크 마커**: 나레이션 `#1` `#2` 유지, 화면텍스트 추출 시 `#N` 단독 박스 제외
- **전문가 검증**: 표+상세 UI, 역번역 표시, 완료 버튼 단일화
- **관리자**: 프로젝트 삭제, 사용자 등록·정보 수정(이름/이메일/비밀번호/역할)
- **nextBMS 디자인**: `nb-*` 유틸 클래스, Layout 사이드바 스타일

### Supabase 배포 (완료)
- 마이그레이션 `20250624180000_workflow_updates.sql` 적용됨
- 마이그레이션 `20250624200000_fix_gen_random_bytes.sql` 적용됨
- 마이그레이션 `20250624210000_profiles_admin_access.sql` 적용됨
- 마이그레이션 `20250710100000_spelling_committed.sql` 적용됨 (`committed_to_slide`)
- `register-user` Edge Function 배포됨 (중복 이메일 복구 포함)
- `update-user` Edge Function 배포됨 (관리자 사용자 정보 수정)

### 이전 (2026-06)
- PPTX 추출: `spTree` 기준 텍스트 도형 수집, 화면텍스트 JSON 파싱
- 나레이션: 하단 좌표(y≥0.78) + 좌표 없는 플레이스홀더 도형 텍스트 패턴 폴백
- 추출 UI: 배치 저장·진행률 표시로 대용량 PPTX 처리 시 멈춤 방지
- 로그인: `signInWithPassword` 직후 세션 반영

배포: [elearning-translator.vercel.app](https://elearning-translator.vercel.app)

> **배포 정책:** `main` 푸시 → Vercel 자동 배포. Edge Function 변경 시 `npx supabase functions deploy spelling-check translate verify` 실행.

## 작업 예정

- ~~전문가 검토 **되돌리기**~~ (완료)
- ~~nextBMS 디자인 나머지 페이지 통일~~ (완료)
