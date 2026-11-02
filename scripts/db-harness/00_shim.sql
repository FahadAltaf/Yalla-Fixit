-- The parts of the production database the Finance & Reports migrations
-- touch, as production has them on 20 Oct 2026 (column sets from the
-- PostgREST description; policies from the applied migrations). Local
-- throwaway cluster only.
\set ON_ERROR_STOP on

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Supabase's default privileges: every new table, sequence and function
-- in public is granted to the API roles. New tables must revoke them.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Supabase Storage's bucket table, as far as the finance evidence bucket uses it.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.role_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.roles(id),
  resource text NOT NULL,
  action text NOT NULL,
  enabled boolean DEFAULT true,
  record_access text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, resource, action)
);
CREATE TABLE public.user_profile (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  role_id uuid NOT NULL REFERENCES public.roles(id),
  first_name text, last_name text, full_name text,
  is_active boolean, last_login timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  profile_image text,
  receives_schedule_approval_email boolean NOT NULL DEFAULT false
);
-- 20261006160000 is held, so production still has "Allow All" here.
ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow All on User Profile" ON public.user_profile FOR ALL TO public USING (true) WITH CHECK (true);

CREATE TABLE public.technician_reference (
  fsm_resource_id text PRIMARY KEY,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  role_id uuid, service_type_id uuid,
  shift text CHECK (shift IN ('morning', 'night')),
  team_leader_fsm_id text REFERENCES public.technician_reference(fsm_resource_id) ON DELETE SET NULL,
  board_position integer
);
-- 20261006163000 (applied): authenticated may read, nobody else via the API.
ALTER TABLE public.technician_reference ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.technician_reference FROM anon, authenticated;
GRANT SELECT ON public.technician_reference TO authenticated;
CREATE POLICY "technician_reference authenticated read" ON public.technician_reference FOR SELECT TO authenticated USING (true);

CREATE TABLE public.leave_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_fsm_id text NOT NULL REFERENCES public.technician_reference(fsm_resource_id),
  leave_type text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  notes text,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  CONSTRAINT leave_records_end_not_before_start CHECK (end_at >= start_at)
);
ALTER TABLE public.leave_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leave_records FROM anon, authenticated;

-- Rows that exist before the migrations, so defaults on live data are checked.
INSERT INTO public.roles (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'admin');
INSERT INTO public.user_profile (id, email, role_id, full_name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'tech.one@test.local', '00000000-0000-0000-0000-0000000000a1', 'Tech One'),
  ('00000000-0000-0000-0000-000000000002', 'office@test.local', '00000000-0000-0000-0000-0000000000a1', 'Office');
INSERT INTO public.technician_reference (fsm_resource_id, display_name) VALUES ('T1', 'Tech One'), ('T2', 'Tech Two');
INSERT INTO public.leave_records (technician_fsm_id, leave_type, start_at, end_at)
VALUES ('T1', 'Annual leave', '2026-10-01 05:00+04', '2026-10-02 17:00+04');
