-- 완료된 전문가 검증에는 항목을 자동 삽입하지 않음 (재추출·재번역 후 잠금 해제용)

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

  -- pending/in_progress 만 항목 복구. done 리뷰에 새 번역을 붙이면 수정 불가인데 항목만 보이는 상태가 됨
  IF v_review.status IN ('pending', 'in_progress')
    AND NOT EXISTS (
      SELECT 1 FROM expert_review_items WHERE expert_review_id = v_review.id
    )
  THEN
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

GRANT EXECUTE ON FUNCTION get_expert_review_by_token(TEXT) TO anon, authenticated;
