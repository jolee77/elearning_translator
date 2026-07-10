-- 맞춤법: 검토(변경/제외)와 슬라이드 반영 분리
ALTER TABLE spelling_results
  ADD COLUMN IF NOT EXISTS committed_to_slide boolean NOT NULL DEFAULT false;
