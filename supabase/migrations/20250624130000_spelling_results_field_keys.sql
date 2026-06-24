-- 화면 텍스트박스별 field 키(screen_text_<id>) 허용
ALTER TABLE spelling_results
  DROP CONSTRAINT IF EXISTS spelling_results_field_check;

ALTER TABLE spelling_results
  ADD CONSTRAINT spelling_results_field_check
  CHECK (
    field = 'narration'
    OR field = 'screen_text'
    OR field ~ '^screen_text_.+'
  );
