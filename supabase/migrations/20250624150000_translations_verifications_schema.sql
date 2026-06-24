-- translations: 슬라이드당 1행(구) → 필드별 행(신) 스키마
-- verifications: match/edited_tr(구) → score(신), apply_status 값 정리

DELETE FROM verifications;
DELETE FROM translations;

ALTER TABLE translations DROP CONSTRAINT IF EXISTS translations_slide_id_key;
ALTER TABLE translations DROP CONSTRAINT IF EXISTS translations_speed_status_check;

ALTER TABLE translations
  DROP COLUMN IF EXISTS ko_screen,
  DROP COLUMN IF EXISTS ko_narration,
  DROP COLUMN IF EXISTS tr_screen,
  DROP COLUMN IF EXISTS tr_narration,
  DROP COLUMN IF EXISTS tr_section,
  DROP COLUMN IF EXISTS speed_status,
  DROP COLUMN IF EXISTS ko_sec,
  DROP COLUMN IF EXISTS tr_sec;

ALTER TABLE translations
  ADD COLUMN field text NOT NULL,
  ADD COLUMN source text,
  ADD COLUMN vi_text text,
  ADD COLUMN cpm integer,
  ADD COLUMN vi_wpm integer;

ALTER TABLE translations
  ADD CONSTRAINT translations_slide_field_key UNIQUE (slide_id, field);

ALTER TABLE translations
  ADD CONSTRAINT translations_field_check
  CHECK (
    field = 'tr_narration'
    OR field = 'screen_text'
    OR field ~ '^screen_text_.+'
  );

-- verifications
ALTER TABLE verifications DROP CONSTRAINT IF EXISTS verifications_match_check;
ALTER TABLE verifications DROP CONSTRAINT IF EXISTS verifications_apply_status_check;

ALTER TABLE verifications DROP COLUMN IF EXISTS match;
ALTER TABLE verifications DROP COLUMN IF EXISTS edited_tr;

ALTER TABLE verifications ADD COLUMN score integer;

ALTER TABLE verifications
  ADD CONSTRAINT verifications_apply_status_check
  CHECK (apply_status IN ('pending', 'applied', 'skipped'));
