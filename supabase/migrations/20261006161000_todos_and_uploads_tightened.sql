-- =====================================================================
-- Todos server-only; uploads bucket writable only by signed-in users
--
-- NOT APPLIED. Branch amc-hardening (security phase, 6 Oct 2026).
-- SAFE BEFORE CODE DEPLOY: the live main application reads and writes
-- todos only through /api/todos* with the service role, and uploads to
-- the `uploads` bucket only from a signed-in session (saveFile, profile and
-- organisation settings). Both checked on origin/main.
--
-- 1. todos: production has "Allow All on todos" FOR ALL TO public, so the
--    anon key reads and rewrites every todo. Todos now carry AMC renewal
--    reminders (customer names, contract ends). Server-only, like the AMC
--    tables.
-- 2. storage `uploads` (public bucket, stays public for reading: logos
--    and avatars are linked by public URL): the INSERT and UPDATE policies
--    applied to the `public` role, so anyone could upload into, or
--    overwrite, the company's public file host. Now signed-in users only,
--    and only their own objects for UPDATE.
-- =====================================================================

-- 1. todos (and its child tables written the same way)
DROP POLICY IF EXISTS "Allow All on todos" ON public.todos;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.todos FROM anon, authenticated;

-- 2. uploads bucket
DROP POLICY IF EXISTS "Allow authenticated users to upload files" ON storage.objects;
CREATE POLICY "Allow authenticated users to upload files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'uploads');
DROP POLICY IF EXISTS "Allow users to update their own uploads" ON storage.objects;
CREATE POLICY "Allow users to update their own uploads"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'uploads' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'uploads' AND owner = auth.uid());

-- ---------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------
--   GRANT ALL ON public.todos TO anon, authenticated;
--   CREATE POLICY "Allow All on todos" ON public.todos FOR ALL TO public USING (true) WITH CHECK (true);
--   DROP POLICY "Allow authenticated users to upload files" ON storage.objects;
--   CREATE POLICY "Allow authenticated users to upload files" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'uploads');
--   DROP POLICY "Allow users to update their own uploads" ON storage.objects;
--   CREATE POLICY "Allow users to update their own uploads" ON storage.objects FOR UPDATE TO public USING (true) WITH CHECK (bucket_id = 'uploads');
