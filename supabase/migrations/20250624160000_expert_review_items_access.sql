-- expert_review_items: translations와 동일한 field 키 허용 + RLS INSERT

ALTER TABLE expert_review_items
  DROP CONSTRAINT IF EXISTS expert_review_items_field_check;

ALTER TABLE expert_review_items
  ADD CONSTRAINT expert_review_items_field_check
  CHECK (
    field = 'narration'
    OR field = 'tr_narration'
    OR field = 'screen_text'
    OR field ~ '^screen_text_.+'
    OR field = 'screen'
  );

ALTER TABLE expert_review_items
  DROP CONSTRAINT IF EXISTS expert_review_items_status_check;

ALTER TABLE expert_review_items
  ADD CONSTRAINT expert_review_items_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'modified'));

ALTER TABLE expert_review_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "프로젝트 소유자 expert_review_items 조회" ON expert_review_items;
DROP POLICY IF EXISTS "프로젝트 소유자 expert_review_items 생성" ON expert_review_items;

CREATE POLICY "프로젝트 소유자 expert_review_items 조회"
  ON expert_review_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM expert_reviews er
      JOIN projects p ON p.id = er.project_id
      WHERE er.id = expert_review_items.expert_review_id
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "프로젝트 소유자 expert_review_items 생성"
  ON expert_review_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM expert_reviews er
      JOIN projects p ON p.id = er.project_id
      WHERE er.id = expert_review_items.expert_review_id
        AND p.created_by = auth.uid()
    )
  );
