-- create_expert_review 오버로드 충돌 해소
-- PostgREST가 4인자/5인자(p_storyboard_id) 중 하나를 고르지 못함
DROP FUNCTION IF EXISTS public.create_expert_review(UUID, TEXT, TEXT, TEXT, UUID);

-- 앱이 사용하는 4인자 시그니처만 유지·재부여
GRANT EXECUTE ON FUNCTION public.create_expert_review(UUID, TEXT, TEXT, TEXT) TO authenticated;
