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

# 환경 변수 설정 (.env)
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

## 최근 수정 (2026-06)

- PPTX 추출: `spTree` 기준 텍스트 도형 수집, 화면텍스트 JSON 파싱
- 나레이션: 하단 좌표(y≥0.78) + 좌표 없는 플레이스홀더 도형 텍스트 패턴 폴백
- 추출 UI: 배치 저장·진행률 표시로 대용량 PPTX 처리 시 멈춤 방지
- 로그인: `signInWithPassword` 직후 세션 반영

배포: [elearning-translator.vercel.app](https://elearning-translator.vercel.app)

> **배포 정책:** `main`에 푸시하면 Vercel이 자동 배포한다. 코드 수정 후에는 커밋·푸시까지 완료한다 (`.cursor/rules/deploy-on-change.mdc`).
