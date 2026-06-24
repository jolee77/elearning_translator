-- 앱 코드가 사용하는 이벤트형 변경 이력 컬럼 추가 (기존 field-level 컬럼은 유지)
ALTER TABLE change_logs
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS detail text,
  ADD COLUMN IF NOT EXISTS metadata jsonb;
