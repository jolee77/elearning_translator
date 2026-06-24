-- Supabase: pgcrypto 함수는 extensions 스키마에 있음
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

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

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

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
