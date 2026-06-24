-- 전문가 검토 항목 되돌리기: reviewed → pending

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
    UPDATE translations t
    SET vi_text = p_vi_text, updated_at = now()
    WHERE t.project_id = v_project_id
      AND t.slide_id = v_item.slide_id
      AND t.field = v_item.field;
  END IF;

  IF v_review.status = 'pending' AND v_final_status <> 'pending' THEN
    UPDATE expert_reviews
    SET status = 'in_progress'
    WHERE id = v_review.id;
  END IF;

  RETURN v_item;
END;
$$;
