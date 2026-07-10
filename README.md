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

## 최근 수정 (2026-07-10)

### PPTX 파서 v2 이식
- **1~9장 가이드 강제 제외 폐지** — 화면번호·본문 패턴으로 intro/divider/lesson 등 분류
- **레이아웃+슬라이드 병합**, 영역 겹침 50% 기준 분류
- **슬라이드 마스터 텍스트 제외** — `이미지 번호`, `화면번호` 등 라벨이 나레이션/화면에 섞이지 않음
- **나레이션 `SlideTextBox[]` 저장** — 화면텍스트와 동일 박스 크기·폰트, Step 1 `nb-textarea` UI
- **싱크 마커 유지** — `#1`, `‹#›` 등 나레이션에서 보존
- Edge Function `_shared/slides.ts`: `formatNarration` / `normalizeNarration` 반영

> 기존 프로젝트는 Step 1 **「다시 추출」** 필요.

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
- **관리자**: 프로젝트 삭제, 사용자 등록(비밀번호+역할)
- **nextBMS 디자인**: `nb-*` 유틸 클래스, Layout 사이드바 스타일

### Supabase 배포 (완료)
- 마이그레이션 `20250624180000_workflow_updates.sql` 적용됨
- 마이그레이션 `20250624200000_fix_gen_random_bytes.sql` 적용됨
- 마이그레이션 `20250624210000_profiles_admin_access.sql` 적용됨
- `register-user` Edge Function 배포됨 (중복 이메일 복구 포함)

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
