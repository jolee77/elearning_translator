-- 전문가 검증: 항목 생성 RPC + 조회 시 누락 항목 자동 복구 + slides LEFT JOIN

DROP FUNCTION IF EXISTS create_expert_review(UUID, TEXT, TEXT, TEXT);

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

  INSERT INTO expert_review_items (expert_review_id, slide_id, field, status)
  SELECT v_review.id, t.slide_id, t.field, 'pending'
  FROM translations t
  JOIN slides s ON s.id = t.slide_id
  WHERE t.project_id = p_project_id;

  UPDATE projects
  SET status = 'expert_review', updated_at = now()
  WHERE id = p_project_id;

  RETURN v_review;
END;
$$;

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

  -- 기존 링크에 항목이 누락된 경우 translations에서 자동 복구
  IF NOT EXISTS (
    SELECT 1 FROM expert_review_items WHERE expert_review_id = v_review.id
  ) THEN
    INSERT INTO expert_review_items (expert_review_id, slide_id, field, status)
    SELECT v_review.id, t.slide_id, t.field, 'pending'
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
      'vi_text', t.vi_text
    ) ORDER BY COALESCE(s.slide_num, 999999), i.field
  ), '[]'::json)
  INTO v_items
  FROM expert_review_items i
  LEFT JOIN slides s ON s.id = i.slide_id
  LEFT JOIN translations t
    ON t.slide_id = i.slide_id AND t.field = i.field AND t.project_id = v_project.id
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

GRANT EXECUTE ON FUNCTION create_expert_review(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_expert_review_by_token(TEXT) TO anon, authenticated;
