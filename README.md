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
