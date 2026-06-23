-- 전문가 검증: 추가 컬럼 및 RPC 함수

ALTER TABLE expert_reviews
  ADD COLUMN IF NOT EXISTS reviewer_email TEXT,
  ADD COLUMN IF NOT EXISTS memo TEXT;

ALTER TABLE expert_reviews
  ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(32), 'hex');

-- 토큰으로 전문가 검증 세션 조회 (RLS 우회)
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

  SELECT COALESCE(json_agg(row_to_json(i) ORDER BY s.slide_num, i.field_key), '[]'::json)
  INTO v_items
  FROM expert_review_items i
  JOIN slides s ON s.id = i.slide_id
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

-- 전문가 검토 항목 저장 (RLS 우회)
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

  UPDATE expert_review_items
  SET
    status = p_status,
    vi_text = COALESCE(p_vi_text, vi_text),
    comment = p_comment,
    updated_at = now()
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  IF v_review.status = 'pending' THEN
    UPDATE expert_reviews
    SET status = 'in_progress', updated_at = now()
    WHERE id = v_review.id;
  END IF;

  RETURN v_item;
END;
$$;

-- 전문가 검증 완료 처리
CREATE OR REPLACE FUNCTION complete_expert_review(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review expert_reviews%ROWTYPE;
  v_pending INT;
BEGIN
  SELECT * INTO v_review FROM expert_reviews WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;

  SELECT COUNT(*) INTO v_pending
  FROM expert_review_items
  WHERE expert_review_id = v_review.id AND status = 'pending';

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'Not all items reviewed';
  END IF;

  UPDATE translations t
  SET vi_text = i.vi_text, updated_at = now()
  FROM expert_review_items i
  WHERE i.expert_review_id = v_review.id
    AND i.translation_id = t.id
    AND i.status = 'rejected';

  UPDATE expert_reviews
  SET status = 'done', updated_at = now()
  WHERE id = v_review.id;

  UPDATE projects
  SET status = 'done', updated_at = now()
  WHERE id = v_review.project_id;

  INSERT INTO change_logs (project_id, user_id, action, detail, metadata)
  VALUES (
    v_review.project_id,
    NULL,
    'expert_review_done',
    '전문가 검증 완료: ' || COALESCE(v_review.reviewer_name, '전문가'),
    json_build_object(
      'reviewer_name', v_review.reviewer_name,
      'reviewer_email', v_review.reviewer_email
    )
  );

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION get_expert_review_by_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION save_expert_review_item(TEXT, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_expert_review(TEXT) TO anon, authenticated;
