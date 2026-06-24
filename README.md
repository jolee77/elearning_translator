# elearning-translator

한국어 이러닝 스토리보드(PPTX)를 베트남어로 번역하는 웹서비스.

## 기술 스택

- React 18 + Vite + TypeScript
- Tailwind CSS v4
- Supabase (Auth, DB, Storage)
- React Query + React Router

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

## 최근 수정 (2026-06-24)

### 워크플로·기능
- **5단계 UI**: 번역·역번역 검증 Step 3 통합 (`TranslationVerificationStep`)
- **싱크 마커**: 나레이션 `#1` `#2` 유지, 화면텍스트 추출 시 `#N` 단독 박스 제외
- **전문가 검증**: 표+상세 UI, 역번역 표시, 완료 버튼 단일화
- **관리자**: 프로젝트 삭제, 사용자 등록(비밀번호+역할)
- **nextBMS 디자인**: `nb-*` 유틸 클래스, Layout 사이드바 스타일

### Supabase 배포 (완료)
- 마이그레이션 `20250624180000_workflow_updates.sql` 적용됨
- `register-user` Edge Function 배포됨

### 이전 (2026-06)
- PPTX 추출: `spTree` 기준 텍스트 도형 수집, 화면텍스트 JSON 파싱
- 나레이션: 하단 좌표(y≥0.78) + 좌표 없는 플레이스홀더 도형 텍스트 패턴 폴백
- 추출 UI: 배치 저장·진행률 표시로 대용량 PPTX 처리 시 멈춤 방지
- 로그인: `signInWithPassword` 직후 세션 반영

배포: [elearning-translator.vercel.app](https://elearning-translator.vercel.app)

> **배포 정책:** `main`에 푸시하면 Vercel이 자동 배포한다. Supabase 마이그레이션·Edge Function 배포 후 `git push`한다.

## 작업 예정

- ~~전문가 검토 **되돌리기**~~ (완료)
- ~~nextBMS 디자인 나머지 페이지 통일~~ (완료)
