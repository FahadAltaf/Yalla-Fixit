-- Migration: Manpower Compliance document attachments
-- Description: Sharon's action point C2 (28 Oct 2026). A certificate (and,
--              if Sharon agrees, an Emirates ID or passport copy) can carry
--              uploaded files. Every upload is kept: a renewal adds a new
--              file and the older ones stay as history. Files live in a
--              private bucket, opened only through short-lived signed links
--              minted for people holding the identity-numbers right.
--              Additive, no data change.

CREATE TABLE IF NOT EXISTS public.compliance_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.compliance_employees(id) ON DELETE CASCADE,
  -- 'cert:<certificate_type_id>', 'emirates_id' or 'passport' (same keys as the reminder list).
  item_key TEXT NOT NULL,
  -- The item's expiry when the file was uploaded, so history reads per renewal.
  expiry_date DATE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  uploaded_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT compliance_documents_item_key_check CHECK (
    item_key ~ '^(emirates_id|passport|cert:[0-9a-f-]{36})$'
  ),
  CONSTRAINT compliance_documents_name_not_empty CHECK (LENGTH(TRIM(file_name)) > 0),
  CONSTRAINT compliance_documents_size_check CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  CONSTRAINT compliance_documents_type_check CHECK (
    content_type IN ('application/pdf', 'image/jpeg', 'image/png')
  )
);

CREATE INDEX IF NOT EXISTS compliance_documents_employee_item_idx
  ON public.compliance_documents (employee_id, item_key, created_at DESC);

COMMENT ON TABLE public.compliance_documents IS
  'Files attached to a compliance item (C2). Never deleted by the app; the newest per item is current, older ones are history.';

ALTER TABLE public.compliance_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.compliance_documents FROM anon, authenticated;

-- The audit log learns the new entity.
ALTER TABLE public.compliance_audit_events DROP CONSTRAINT IF EXISTS compliance_audit_entity_check;
ALTER TABLE public.compliance_audit_events ADD CONSTRAINT compliance_audit_entity_check CHECK (
  entity_type IN ('employee', 'identity', 'certificate', 'certificate_type', 'list', 'site',
                  'settings', 'role_requirement', 'identity_viewer', 'recipient', 'import',
                  'export', 'reminder_run', 'document')
);
ALTER TABLE public.compliance_audit_events DROP CONSTRAINT IF EXISTS compliance_audit_event_check;
ALTER TABLE public.compliance_audit_events ADD CONSTRAINT compliance_audit_event_check CHECK (
  event_type IN ('create', 'edit', 'archive', 'unarchive', 'reveal', 'export', 'import',
                 'import_rollback', 'hr_sync', 'grant', 'revoke', 'upload', 'open')
);

-- Private bucket: 10 MB, PDF / JPG / PNG. No storage policies, so only the
-- service role (the portal's routes) can read or write objects.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('compliance', 'compliance', FALSE, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

SELECT to_regclass('public.compliance_documents') AS documents,
       (SELECT public FROM storage.buckets WHERE id = 'compliance') AS bucket_public;
