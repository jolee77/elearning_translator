-- 관리자 설정: 목표 언어 기본값 컬럼 추가

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS default_target_lang TEXT NOT NULL DEFAULT 'vi';
