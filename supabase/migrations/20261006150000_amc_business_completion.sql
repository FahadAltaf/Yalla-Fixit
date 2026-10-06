-- =====================================================================
-- AMC business completion: notifications, signed-contract archive,
-- private AMC document storage, assessment photos
--
-- NOT APPLIED. Branch amc-hardening (6 Oct 2026). Apply after
-- 20261006140000_amc_atomic_activation_and_dashboard.sql. Additive only:
-- nothing the live main application uses is changed.
--
-- 1. amc_notifications: one row per event, recipient and channel. The
--    in-app list reads it and the email sender records its outcome on it.
--    The dedupe key makes a retried endpoint, a double click or a second
--    reminder sweep a no-op. It is a log over the existing delivery paths
--    (Resend email, the portal), not a second notification system.
-- 2. amc_notification_settings: one row. Which channels each event uses
--    and the renewal-reminder schedule and recipients. Automatic reminder
--    delivery is OFF, and so are entitlement emails, until the business
--    confirms recipients and schedule.
-- 3. amc_signed_documents: the archived signed contract. The exact
--    content (document model + signature) as JSON, its hash, and the
--    stored file's path and hash. Immutable: no update, no delete.
-- 4. Storage bucket amc-documents: PRIVATE, and with no storage policy at
--    all, so only the service role (the API) can read or write it. Files
--    are handed out as short-lived signed URLs after the API's own access
--    check. The public "uploads" bucket is never used for AMC documents.
-- 5. amc_assessment_photos: photos of an assessment, in amc-documents.
--    Removable while the assessment is a draft; kept for good once it is
--    completed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Notifications
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL CHECK (event IN (
    'proposal_submitted', 'proposal_approved', 'proposal_sent_back', 'proposal_sent',
    'client_approved', 'client_rejected', 'contract_sent', 'contract_signed',
    'contract_activated', 'entitlement_low', 'entitlement_exhausted',
    'contract_expiring', 'renewal_created'
  )),
  /* What it is about. Not foreign keys: a notification outlives nothing,
     and a deleted draft proposal must not take its history with it. */
  submission_id uuid,
  contract_id uuid,
  entitlement_id uuid,
  recipient_user_id uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  recipient_email text,
  CONSTRAINT amc_notifications_has_recipient CHECK (recipient_user_id IS NOT NULL OR recipient_email IS NOT NULL),
  channel text NOT NULL CHECK (channel IN ('in_app', 'email')),
  /* Same event, same subject, same recipient, same channel = same row. */
  dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 300),
  recipient_key text GENERATED ALWAYS AS (coalesce(recipient_user_id::text, lower(recipient_email))) STORED,
  title text NOT NULL,
  body text NOT NULL,
  /* A portal path (never a client token link). */
  link text,
  /* in_app rows are 'delivered' when written; email rows move from
     pending to sent / failed, or are 'disabled' when the channel is off. */
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'sent', 'failed', 'disabled')),
  status_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  read_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_notifications_dedupe
  ON public.amc_notifications (dedupe_key, channel, recipient_key);
/* The bell: a user's in-app notifications, newest first, and the unread count. */
CREATE INDEX IF NOT EXISTS idx_amc_notifications_inbox
  ON public.amc_notifications (recipient_user_id, created_at DESC) WHERE channel = 'in_app';
CREATE INDEX IF NOT EXISTS idx_amc_notifications_unread
  ON public.amc_notifications (recipient_user_id) WHERE channel = 'in_app' AND read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_amc_notifications_contract
  ON public.amc_notifications (contract_id, created_at DESC) WHERE contract_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Notification settings (one row)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_notification_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  /* Workflow emails (approvals, client answers, signature, activation)
     go to people the workflow already names: the approvers and the
     proposal owner. */
  workflow_email_enabled boolean NOT NULL DEFAULT true,
  /* Low / exhausted allowance alerts: in-app always; email off until the
     recipients are confirmed. */
  entitlement_email_enabled boolean NOT NULL DEFAULT false,
  /* Renewal reminders. Defaults are configuration, not an approved
     schedule. Automatic delivery stays off until it is confirmed. */
  reminder_auto_enabled boolean NOT NULL DEFAULT false,
  reminder_thresholds integer[] NOT NULL DEFAULT '{60,30,15}',
  reminder_recipients text[] NOT NULL DEFAULT '{owner}',
  reminder_channels text[] NOT NULL DEFAULT '{in_app}',
  reminder_extra_emails text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_notification_thresholds_valid CHECK (
    cardinality(reminder_thresholds) <= 6
    AND 0 < ALL (reminder_thresholds) AND 366 > ALL (reminder_thresholds)
  ),
  CONSTRAINT amc_notification_recipients_valid CHECK (reminder_recipients <@ ARRAY['owner', 'approvers']::text[]),
  CONSTRAINT amc_notification_channels_valid CHECK (reminder_channels <@ ARRAY['in_app', 'email']::text[]),
  CONSTRAINT amc_notification_extra_emails_valid CHECK (cardinality(reminder_extra_emails) <= 10)
);
INSERT INTO public.amc_notification_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Signed-contract archive
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_signed_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.amc_submissions(id) ON DELETE RESTRICT,
  document_type text NOT NULL DEFAULT 'signed_contract' CHECK (document_type IN ('signed_contract')),
  proposal_number text NOT NULL,
  signed_by_name text NOT NULL CHECK (length(trim(signed_by_name)) > 0),
  signed_at timestamptz NOT NULL,
  /* 'at_signing': written by the signature request itself.
     'after_signing': written later from the same frozen data (a retry, or
     a contract signed before archiving existed); the screen says so. */
  archived_when text NOT NULL CHECK (archived_when IN ('at_signing', 'after_signing')),
  /* Which saved wording it was built from: never the live settings. */
  settings_source text NOT NULL CHECK (settings_source IN ('contract_settings_snapshot', 'settings_snapshot')),
  /* The exact content: the document model and the signature, as JSON. */
  content jsonb NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  storage_bucket text NOT NULL DEFAULT 'amc-documents' CHECK (storage_bucket = 'amc-documents'),
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('application/pdf', 'text/html')),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, document_type)
);

CREATE OR REPLACE FUNCTION public.amc_signed_documents_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'An archived signed document cannot be changed or removed'
    USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS amc_signed_documents_immutable ON public.amc_signed_documents;
CREATE TRIGGER amc_signed_documents_immutable
  BEFORE UPDATE OR DELETE ON public.amc_signed_documents
  FOR EACH ROW EXECUTE FUNCTION public.amc_signed_documents_immutable();
DROP TRIGGER IF EXISTS amc_signed_documents_no_truncate ON public.amc_signed_documents;
CREATE TRIGGER amc_signed_documents_no_truncate
  BEFORE TRUNCATE ON public.amc_signed_documents
  FOR EACH STATEMENT EXECUTE FUNCTION public.amc_signed_documents_immutable();
REVOKE ALL ON FUNCTION public.amc_signed_documents_immutable() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Private storage for AMC documents
-- ---------------------------------------------------------------------
/* No storage.objects policy is created for this bucket: anon and
   authenticated get nothing, the service role (which bypasses RLS) does
   everything, through the API. */
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('amc-documents', 'amc-documents', false, 20971520,
        ARRAY['application/pdf', 'text/html', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false;

-- ---------------------------------------------------------------------
-- 5. Assessment photos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_assessment_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* CASCADE only reaches drafts: a completed assessment cannot be deleted. */
  assessment_id uuid NOT NULL REFERENCES public.amc_assessments(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  caption text CHECK (caption IS NULL OR length(caption) <= 300),
  uploaded_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_amc_assessment_photos_assessment
  ON public.amc_assessment_photos (assessment_id, created_at);

/* Photos are evidence: added and removed only while the assessment is a
   draft, never changed. */
CREATE OR REPLACE FUNCTION public.amc_assessment_photos_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  st text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'An assessment photo cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  SELECT status INTO st FROM public.amc_assessments
   WHERE id = COALESCE(NEW.assessment_id, OLD.assessment_id);
  IF st = 'completed' THEN
    RAISE EXCEPTION 'A completed assessment''s photos cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS amc_assessment_photos_locked ON public.amc_assessment_photos;
CREATE TRIGGER amc_assessment_photos_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.amc_assessment_photos
  FOR EACH ROW EXECUTE FUNCTION public.amc_assessment_photos_locked();
REVOKE ALL ON FUNCTION public.amc_assessment_photos_locked() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- Access: service role only, like every AMC table
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_signed_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_assessment_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_notifications, public.amc_notification_settings,
  public.amc_signed_documents, public.amc_assessment_photos FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Rollback (before any notification, archive or photo exists)
-- ---------------------------------------------------------------------
--   DROP TABLE IF EXISTS public.amc_assessment_photos;
--   DROP FUNCTION IF EXISTS public.amc_assessment_photos_locked();
--   DROP TABLE IF EXISTS public.amc_signed_documents;
--   DROP FUNCTION IF EXISTS public.amc_signed_documents_immutable();
--   DROP TABLE IF EXISTS public.amc_notification_settings;
--   DROP TABLE IF EXISTS public.amc_notifications;
--   DELETE FROM storage.buckets WHERE id = 'amc-documents';  -- only when empty
