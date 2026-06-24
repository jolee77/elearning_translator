-- 워크플로 개선: 전문가 검토 단순화, 역번역 제공, 관리자 프로젝트 삭제

-- 전문가 검토 항목: 원문 번역문 스냅샷 (변경 추적용)
ALTER TABLE expert_review_items
  ADD COLUMN IF NOT EXISTS original_vi_text TEXT;

-- 상태: reviewed 추가 (승인/수정완료 구분 없이 검토 완료)
ALTER TABLE expert_review_items
  DROP CONSTRAINT IF EXISTS expert_review_items_status_check;

ALTER TABLE expert_review_items
  ADD CONSTRAINT expert_review_items_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'modified', 'reviewed'));

-- 전문가 검증 생성 시 원문 번역문 스냅샷 저장
CREATE OR REPLACE FUNCTION create_expert_review(
  p_project_id UUID,
  p_expert_name TEXT,
  p_expert_email TEXT,
  p_message TEXT DEFAULT NULL
)
RETURNS expert_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review expert_reviews%ROWTYPE;
  v_token TEXT;
  v_translation_count INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM projects
    WHERE id = p_project_id AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_translation_count
  FROM translations t
  JOIN slides s ON s.id = t.slide_id
  WHERE t.project_id = p_project_id;

  IF v_translation_count = 0 THEN
    RAISE EXCEPTION 'No translations';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO expert_reviews (
    project_id,
    token,
    status,
    expert_name,
    expert_email,
    message
  )
  VALUES (
    p_project_id,
    v_token,
    'pending',
    NULLIF(trim(p_expert_name), ''),
    NULLIF(trim(p_expert_email), ''),
    NULLIF(trim(p_message), '')
  )
  RETURNING * INTO v_review;

  INSERT INTO expert_review_items (expert_review_id, slide_id, field, status, original_vi_text)
  SELECT v_review.id, t.slide_id, t.field, 'pending', t.vi_text
  FROM translations t
  JOIN slides s ON s.id = t.slide_id
  WHERE t.project_id = p_project_id;

  UPDATE projects
  SET status = 'expert_review', updated_at = now()
  WHERE id = p_project_id;

  RETURN v_review;
END;
$$;

-- 토큰 조회: 역번역·원문 번역문 스냅샷 포함
CREATE OR REPLACE FUNCTION get_expert_review_by_token(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review expert_reviews%ROWTYPE;
  v_project projects%ROWTYPE;
  v_items JSON;
  v_slides JSON;
BEGIN
  SELECT * INTO v_review FROM expert_reviews WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;

  SELECT * INTO v_project FROM projects WHERE id = v_review.project_id;

  IF NOT EXISTS (
    SELECT 1 FROM expert_review_items WHERE expert_review_id = v_review.id
  ) THEN
    INSERT INTO expert_review_items (expert_review_id, slide_id, field, status, original_vi_text)
    SELECT v_review.id, t.slide_id, t.field, 'pending', t.vi_text
    FROM translations t
    JOIN slides s ON s.id = t.slide_id
    WHERE t.project_id = v_review.project_id;
  END IF;

  SELECT COALESCE(json_agg(
    json_build_object(
      'id', i.id,
      'expert_review_id', i.expert_review_id,
      'slide_id', i.slide_id,
      'field', i.field,
      'status', i.status,
      'comment', i.comment,
      'created_at', i.created_at,
      'source', t.source,
      'vi_text', t.vi_text,
      'original_vi_text', COALESCE(i.original_vi_text, t.vi_text),
      'back_translation', v.back_translation
    ) ORDER BY COALESCE(s.slide_num, 999999), i.field
  ), '[]'::json)
  INTO v_items
  FROM expert_review_items i
  LEFT JOIN slides s ON s.id = i.slide_id
  LEFT JOIN translations t
    ON t.slide_id = i.slide_id AND t.field = i.field AND t.project_id = v_project.id
  LEFT JOIN verifications v ON v.translation_id = t.id
  WHERE i.expert_review_id = v_review.id;

  SELECT COALESCE(json_agg(
    json_build_object(
      'id', s.id,
      'slide_num', s.slide_num,
      'screen_num', s.screen_num
    ) ORDER BY s.slide_num
  ), '[]'::json)
  INTO v_slides
  FROM slides s
  WHERE s.id IN (
    SELECT slide_id FROM expert_review_items WHERE expert_review_id = v_review.id
  );

  RETURN json_build_object(
    'review', row_to_json(v_review),
    'project', json_build_object(
      'id', v_project.id,
      'title', v_project.title,
      'target_lang', v_project.target_lang
    ),
    'items', v_items,
    'slides', v_slides
  );
END;
$$;

-- 전문가 항목 저장: 번역문·코멘트 저장 후 reviewed 처리
CREATE OR REPLACE FUNCTION save_expert_review_item(
  p_token TEXT,
  p_item_id UUID,
  p_status TEXT,
  p_vi_text TEXT DEFAULT NULL,
  p_comment TEXT DEFAULT NULL
)
RETURNS expert_review_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review expert_reviews%ROWTYPE;
  v_item expert_review_items%ROWTYPE;
  v_project_id UUID;
  v_final_status TEXT;
BEGIN
  SELECT * INTO v_review FROM expert_reviews WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;

  IF v_review.status = 'done' THEN
    RAISE EXCEPTION 'Review already completed';
  END IF;

  SELECT * INTO v_item FROM expert_review_items
  WHERE id = p_item_id AND expert_review_id = v_review.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  v_project_id := v_review.project_id;
  v_final_status := CASE
    WHEN p_status IN ('reviewed', 'approved', 'rejected', 'modified') THEN 'reviewed'
    ELSE p_status
  END;

  UPDATE expert_review_items
  SET
    status = v_final_status,
    comment = p_comment
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  IF p_vi_text IS NOT NULL THEN
    UPDATE translations t
    SET vi_text = p_vi_text, updated_at = now()
    WHERE t.project_id = v_project_id
      AND t.slide_id = v_item.slide_id
      AND t.field = v_item.field;
  END IF;

  IF v_review.status = 'pending' THEN
    UPDATE expert_reviews
    SET status = 'in_progress'
    WHERE id = v_review.id;
  END IF;

  RETURN v_item;
END;
$$;

-- 관리자 프로젝트 삭제
CREATE OR REPLACE FUNCTION admin_delete_project(p_project_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM projects WHERE id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION create_expert_review(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_expert_review_by_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION save_expert_review_item(TEXT, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_project(UUID) TO authenticated;
