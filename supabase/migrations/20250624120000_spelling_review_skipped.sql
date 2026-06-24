-- 맞춤법 검사: 설계자가 "적용 안 함"으로 검토 완료한 항목 표시
ALTER TABLE spelling_results
  ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false;
