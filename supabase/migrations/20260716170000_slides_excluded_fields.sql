-- 슬라이드 내 필드 단위 번역/전문가 제외 목록

ALTER TABLE slides
  ADD COLUMN IF NOT EXISTS excluded_fields text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN slides.excluded_fields IS
  '번역·전문가 검증에서 제외할 필드 키 (screen_text_*, tr_narration 등). 전체 제외는 exclude_from_translation 사용';
