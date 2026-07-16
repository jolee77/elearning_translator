-- 번역 대상 선택: 슬라이드별 번역 제외 플래그 + 선택 완료 상태

ALTER TABLE slides
  ADD COLUMN IF NOT EXISTS exclude_from_translation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN slides.exclude_from_translation IS
  'true이면 번역·역번역·산출물에서 제외 (맞춤법 이후 사용자가 선택)';
