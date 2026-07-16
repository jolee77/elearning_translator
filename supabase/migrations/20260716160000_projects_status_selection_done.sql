-- selection_done 상태를 projects.status CHECK에 추가

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'uploaded'::text,
        'extracted'::text,
        'spelling'::text,
        'spelling_done'::text,
        'selection_done'::text,
        'translating'::text,
        'translated'::text,
        'verifying'::text,
        'verified'::text,
        'expert_review'::text,
        'done'::text
      ]
    )
  );
