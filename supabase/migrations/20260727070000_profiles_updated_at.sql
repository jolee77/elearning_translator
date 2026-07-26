-- profiles에 updated_at 추가 (update-user Edge Function / Profile 타입과 스키마 정합)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.profiles
SET updated_at = COALESCE(created_at, now())
WHERE updated_at IS NULL;
