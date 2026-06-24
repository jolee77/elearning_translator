-- 맞춤법 검사: AI가 반환한 검토 사유(issues) 저장
ALTER TABLE spelling_results
  ADD COLUMN IF NOT EXISTS issues jsonb NOT NULL DEFAULT '[]'::jsonb;
