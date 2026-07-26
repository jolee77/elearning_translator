-- 전문가 번역문 수정 시 change_logs 기록 + original_vi_text 스냅샷 보존

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
  v_before TEXT;
  v_slide_num INT;
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
    WHEN p_status = 'pending' THEN 'pending'
    WHEN p_status IN ('reviewed', 'approved', 'rejected', 'modified') THEN 'reviewed'
    ELSE p_status
  END;

  UPDATE expert_review_items
  SET
    status = v_final_status,
    comment = CASE
      WHEN p_status = 'pending' THEN v_item.comment
      ELSE COALESCE(p_comment, v_item.comment)
    END
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  -- 되돌리기(pending) 시 번역문은 변경하지 않음
  IF p_vi_text IS NOT NULL AND p_status <> 'pending' THEN
    SELECT t.vi_text INTO v_before
    FROM translations t
    WHERE t.project_id = v_project_id
      AND t.slide_id = v_item.slide_id
      AND t.field = v_item.field
    LIMIT 1;

    UPDATE translations t
    SET vi_text = p_vi_text, updated_at = now()
    WHERE t.project_id = v_project_id
      AND t.slide_id = v_item.slide_id
      AND t.field = v_item.field;

    -- 스냅샷이 비어 있으면 수정 전 번역문을 보존 (이후 변경 집계용)
    IF v_item.original_vi_text IS NULL THEN
      UPDATE expert_review_items
      SET original_vi_text = COALESCE(v_before, p_vi_text)
      WHERE id = p_item_id
      RETURNING * INTO v_item;
    END IF;

    IF trim(COALESCE(v_before, '')) IS DISTINCT FROM trim(COALESCE(p_vi_text, '')) THEN
      SELECT s.slide_num INTO v_slide_num
      FROM slides s
      WHERE s.id = v_item.slide_id;

      INSERT INTO change_logs (
        project_id,
        user_id,
        slide_id,
        stage,
        field,
        before_value,
        after_value,
        changed_by,
        action,
        detail,
        metadata
      )
      VALUES (
        v_project_id,
        NULL,
        v_item.slide_id,
        'expert_review',
        v_item.field,
        v_before,
        p_vi_text,
        v_review.expert_name,
        'expert_review_edited',
        format('전문가 번역 수정: 슬라이드 %s %s', COALESCE(v_slide_num::text, '?'), v_item.field),
        json_build_object(
          'slide_num', v_slide_num,
          'field', v_item.field,
          'expert_name', v_review.expert_name,
          'before', v_before,
          'after', p_vi_text
        )
      );
    END IF;
  END IF;

  IF v_review.status = 'pending' AND v_final_status <> 'pending' THEN
    UPDATE expert_reviews
    SET status = 'in_progress'
    WHERE id = v_review.id;
  END IF;

  RETURN v_item;
END;
$$;

-- 스냅샷을 현재 번역으로 덮지 않음 (null만 그대로 반환)
CREATE OR REPLACE FUNCTION get_expert_review_by_token(p_token TEXT)
RETURNS json
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
    WHERE t.project_id = v_review.project_id
      AND COALESCE(t.exclude_from_expert_review, false) = false
      AND COALESCE(s.exclude_from_translation, false) = false
      AND NOT (t.field = ANY (COALESCE(s.excluded_fields, '{}'::text[])))
      AND NOT (
        t.field IN ('tr_narration', 'narration')
        AND (
          'tr_narration' = ANY (COALESCE(s.excluded_fields, '{}'::text[]))
          OR 'narration' = ANY (COALESCE(s.excluded_fields, '{}'::text[]))
        )
      );
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
      'original_vi_text', i.original_vi_text,
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

GRANT EXECUTE ON FUNCTION save_expert_review_item(TEXT, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_expert_review_by_token(TEXT) TO anon, authenticated;
