-- =====================================================
-- Migration: Create Base Schema with User Roles ENUM
-- File: 20250501_create_base_schema.sql
-- Description: Sets up the complete database schema including
--              ENUM types, tables, RLS policies, and initial data
-- =====================================================


-- Increase global page size to 1000 rows
COMMENT ON SCHEMA public IS
  ' @graphql({"max_rows": 10000})';




-- Step 2: Create Settings Table
CREATE TABLE public.settings (
  id SERIAL PRIMARY KEY,
  site_name TEXT,
  site_image TEXT,
  appearance_theme TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  logo_url TEXT,
  favicon_url TEXT,
  site_description TEXT,
  meta_keywords TEXT,
  contact_email TEXT,
  social_links JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  logo_setting TEXT,
  logo_horizontal_url TEXT,
  type TEXT
);

-- Step 3: Create Roles Table
CREATE TABLE public.roles (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name TEXT NOT NULL UNIQUE
);

-- Step 4: Create User Profile Table
CREATE TABLE public.user_profile (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role_id UUID NOT NULL,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  profile_image TEXT,
  CONSTRAINT user_profile_id_fkey FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT user_profile_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles (id)
);

-- Step 5: Create Password Resets Table
CREATE TABLE public.password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email TEXT,
  token TEXT,
  expires_at TIMESTAMPTZ,
  user_id UUID,
  used_at TIMESTAMPTZ,
  CONSTRAINT password_resets_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.user_profile(id) ON DELETE CASCADE
);

-- Step 6: Create Storage Bucket for Uploads
INSERT INTO storage.buckets (id, name, public) 
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Step 7: Enable Row Level Security (RLS)
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;

-- Step 8: Create RLS Policies

-- Settings Policies
CREATE POLICY "Allow All on Settings"
ON public.settings
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- Roles Policies
CREATE POLICY "Allow All on Roles"
ON public.roles
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- User Profile Policies
CREATE POLICY "Allow All on User Profile"
ON public.user_profile
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- Password Resets Policies
CREATE POLICY "Allow All on Password Resets"
ON public.password_resets
FOR ALL
TO public
USING (true)
WITH CHECK (true);

-- Storage Policies
CREATE POLICY "Allow public read access to uploads bucket" 
ON storage.objects
FOR SELECT
USING (bucket_id = 'uploads'::text);

CREATE POLICY "Allow authenticated users to upload files" 
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'uploads'::text);

CREATE POLICY "Allow users to update their own uploads" 
ON storage.objects
FOR UPDATE
WITH CHECK (bucket_id = 'uploads'::text);

CREATE POLICY "Allow users to delete their own uploads" 
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'uploads'::text AND auth.uid() = owner);

-- Step 9: Insert Default Roles
INSERT INTO public.roles (id, description, name)
VALUES 
  ('a0eeb1f4-6b6e-4d1a-b1f7-72e1bb78c8d4', 'System administrator with full access', 'admin'),
  ('d9a0935b-9fe1-4550-8f7e-67639fd0c6f0', 'Regular user with basic access', 'user')
ON CONFLICT (name) DO NOTHING;

-- Step 10: Insert Default Settings
INSERT INTO public.settings (
  id,
  site_name,
  site_image,
  appearance_theme,
  primary_color,
  secondary_color,
  logo_url,
  favicon_url,
  site_description,
  meta_keywords,
  contact_email,
  social_links,
  created_at,
  updated_at,
  logo_setting,
  logo_horizontal_url,
  type
)
VALUES (
  1,
  'Acme',
  NULL,
  'light',
  '#83201e',
  NULL,
  'https://eqlrncvnjdoxtxjannkw.supabase.co/storage/v1/object/public/uploads/public/mountain1-01.jpg',
  'https://eqlrncvnjdoxtxjannkw.supabase.co/storage/v1/object/public/uploads/public/mountain1-01.jpg',
  NULL,
  NULL,
  NULL,
  NULL,
  NOW(),
  NOW(),
  'square',
  NULL,
  'admin'
)
ON CONFLICT (id) DO NOTHING;

-- Step 11: Create helpful functions for user management
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT r.name::TEXT INTO user_role
  FROM public.user_profile up
  JOIN public.roles r ON up.role_id = r.id
  WHERE up.id = user_id;
  
  RETURN user_role;
END;
$$;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Migration 20250501_create_base_schema.sql completed successfully!';
END $$;



create table public."AI_Conversations" (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  user_id uuid not null,
  user_role text not null,
  title text null,
  description text null,
  last_message_at timestamp with time zone null,
  metadata jsonb null,
  previous_response_id text null,
  constraint AI_Conversations_pkey primary key (id),
  constraint AI_Conversations_user_id_fkey foreign KEY (user_id) references user_profile (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_ai_conversations_user_id_created_at on public."AI_Conversations" using btree (user_id, created_at) TABLESPACE pg_default;

create table public."AI_Messages" (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone not null default now(),
  conversation_id uuid not null,
  user_id uuid null,
  role text not null,
  content text not null,
  provider_response_id text null,
  metadata jsonb null,
  constraint AI_Messages_pkey primary key (id),
  constraint AI_Messages_conversation_id_fkey foreign KEY (conversation_id) references "AI_Conversations" (id) on delete CASCADE,
  constraint AI_Messages_user_id_fkey foreign KEY (user_id) references user_profile (id) on delete set null,
  constraint AI_Messages_role_check check (
    (
      role = any (
        array['user'::text, 'assistant'::text, 'system'::text]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_ai_messages_conversation_id_created_at on public."AI_Messages" using btree (conversation_id, created_at) TABLESPACE pg_default;

create table public.role_access (
  id uuid not null default extensions.uuid_generate_v4 (),
  role_id uuid not null,
  resource text not null,
  action text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  enabled boolean null default true,
  record_access text null default 'All Records'::text,
  constraint role_access_pkey primary key (id),
  constraint role_access_role_id_resource_action_key unique (role_id, resource, action),
  constraint role_access_role_id_fkey foreign KEY (role_id) references roles (id) on delete CASCADE
) TABLESPACE pg_default;