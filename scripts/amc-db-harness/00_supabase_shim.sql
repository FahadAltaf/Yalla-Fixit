-- Minimal stand-in for the parts of a Supabase project the AMC and
-- hardening migrations touch. Local throwaway cluster only.
\set ON_ERROR_STOP on

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Supabase's default privileges: every new table/sequence/function in
-- public is granted to the API roles. This is what made the "Allow All"
-- policies reachable in the first place.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE);
CREATE TABLE public.user_profile (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  role_id uuid REFERENCES public.roles(id)
);
-- Production (6 Oct 2026): roles and user_profile "Allow All", role_access RLS off.
CREATE TABLE public.role_access (
  role_id uuid REFERENCES public.roles(id),
  resource text,
  action text,
  enabled boolean DEFAULT true,
  UNIQUE (role_id, resource, action)
);

-- schedule_audit_events as production has it (shape trimmed to what the
-- policy test needs) with its "Allow All" policy.
CREATE TABLE public.schedule_audit_events (
  id bigserial PRIMARY KEY,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.schedule_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow All on schedule_audit_events" ON public.schedule_audit_events
  FOR ALL TO public USING (true) WITH CHECK (true);

-- settings as production has it (column set from information_schema,
-- 5 Oct 2026), with its "Allow All on Settings" policy.
CREATE TABLE public.settings (
  id bigint PRIMARY KEY,
  site_name text, site_image text, appearance_theme text, primary_color text,
  secondary_color text, logo_url text, favicon_url text, site_description text,
  meta_keywords text, contact_email text, social_links jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  logo_setting text, logo_horizontal_url text, type text,
  oauth_access_token text, oauth_token_refreshed_at timestamptz,
  org_timezone text, night_shift_start time, night_shift_end time,
  day_shift_start time, day_shift_end time
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow All on Settings" ON public.settings FOR ALL TO public USING (true) WITH CHECK (true);
INSERT INTO public.settings (id, type, site_name, primary_color, oauth_access_token, org_timezone)
VALUES (1, 'admin', 'Yalla Fix It', '#8c1d24', 'SECRET-ZOHO-TOKEN', 'Asia/Dubai');

-- estimate tables, with the live policy names.
CREATE TABLE public.estimate_revisions (id bigserial PRIMARY KEY, root_quotation_number text);
ALTER TABLE public.estimate_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow All on estimate_revisions" ON public.estimate_revisions FOR ALL TO public USING (true) WITH CHECK (true);
CREATE TABLE public.estimate_service_items (id bigserial PRIMARY KEY, quotation_id text);
ALTER TABLE public.estimate_service_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow All on quotation_service_item_images" ON public.estimate_service_items FOR ALL TO public USING (true) WITH CHECK (true);

CREATE TABLE public.password_resets (
  id bigserial PRIMARY KEY, user_id uuid, email text, token text,
  expires_at timestamptz, used_at timestamptz, created_at timestamptz DEFAULT now()
);
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow All on Password Resets" ON public.password_resets FOR ALL TO public USING (true) WITH CHECK (true);
INSERT INTO public.password_resets (email, token, expires_at) VALUES ('admin@test.local', 'RESET-TOKEN', now() + interval '1 hour');

-- todos as in production: 20260520_create_todos_module.sql (inline CHECK)
-- plus 20260523090000 (title, todo_key) and the status columns.
CREATE SEQUENCE public.todos_key_seq;
CREATE TABLE public.todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled' CHECK (length(trim(title)) > 0),
  todo_key text NOT NULL DEFAULT ('YFI-' || nextval('public.todos_key_seq')),
  description text NOT NULL,
  related_type text CHECK (related_type IS NULL OR related_type IN ('work_order', 'quotation', 'appointment')),
  related_id text,
  deadline_at timestamptz NOT NULL,
  reminder_at timestamptz,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'canceled', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE TABLE public.todo_assignees (
  todo_id uuid NOT NULL REFERENCES public.todos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (todo_id, user_id)
);

-- snagging_clients / snagging_properties as in production (columns the AMC migrations reference).
CREATE TABLE public.snagging_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, email text, phone text, company text, crm_contact_id text
);
CREATE TABLE public.snagging_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.snagging_clients(id) ON DELETE SET NULL,
  unit_label text
);

-- Supabase storage, as far as the AMC migrations touch it.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.objects TO anon, authenticated, service_role;
-- The live uploads policies (production, 6 Oct 2026).
CREATE POLICY "Allow public read access to uploads bucket" ON storage.objects FOR SELECT TO public USING (bucket_id = 'uploads');
CREATE POLICY "Allow authenticated users to upload files" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'uploads');
CREATE POLICY "Allow users to update their own uploads" ON storage.objects FOR UPDATE TO public USING (true) WITH CHECK (bucket_id = 'uploads');
INSERT INTO storage.buckets (id, name, public) VALUES ('uploads', 'uploads', true), ('snagging', 'snagging', false);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow All on Roles" ON public.roles FOR ALL TO public USING (true) WITH CHECK (true);
ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow All on User Profile" ON public.user_profile FOR ALL TO public USING (true) WITH CHECK (true);
ALTER TABLE public.role_access ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow All on todos" ON public.todos FOR ALL TO public USING (true) WITH CHECK (true);
