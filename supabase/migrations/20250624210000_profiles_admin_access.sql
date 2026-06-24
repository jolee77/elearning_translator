-- 관리자 사용자 목록/역할 변경: profiles RLS에 admin 접근 추가

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

DROP POLICY IF EXISTS "관리자 프로필 조회" ON profiles;
CREATE POLICY "관리자 프로필 조회"
  ON profiles
  FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "관리자 프로필 수정" ON profiles;
CREATE POLICY "관리자 프로필 수정"
  ON profiles
  FOR UPDATE
  USING (public.is_admin());

-- auth.users에는 있으나 profiles에 없는 계정 복구
INSERT INTO profiles (id, email, name, role)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  'designer'
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE p.id IS NULL
  AND u.email IS NOT NULL;

-- 신규 가입 시 role 기본값 보장
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'name',
    'designer'
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, profiles.name);

  RETURN NEW;
END;
$$;
