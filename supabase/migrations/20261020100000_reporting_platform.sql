-- =====================================================================
-- Finance & Reports P1: the platform tables (DEV-461, DEV-462).
--
-- 1. reporting_settings: one row holding only an administrator's edits.
--    The defaults live in code (lib/reporting/settings.ts), the AMC
--    Settings pattern: a fresh database or a missing row still works.
-- 2. reporting_audit_events: append-only "who changed what" for this
--    project's settings and, later, its HR decisions. A trigger refuses
--    UPDATE, DELETE and TRUNCATE with an error, for the table owner too.
--    Not the silent DO INSTEAD NOTHING rules of amc_audit_events: with a
--    foreign key to user_profile those make every user deletion fail with
--    an internal referential-integrity error (found by the harness). The
--    actor is therefore not a foreign key; actor_label keeps the name.
-- 3. portal_notifications: one row per event, recipient and channel, the
--    proven amc_notifications shape made generic. The in-app inbox reads
--    it; the email sender records its outcome on it. The unique dedupe key
--    makes a retried run, a double click or a second sweep a no-op.
--
-- Live-safe: three new tables, no change to anything live main uses.
-- Server-only: RLS on and no grants to anon or authenticated, so the
-- public key reaches none of it. Idempotent: safe to run twice.
--
-- Apply with the checks in docs/finance-reporting/migrations/20261020100000.md.
-- Rollback (never automatic): docs/finance-reporting/migrations/20261020100000_rollback.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Reporting Settings (one row)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reporting_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(overrides) = 'object'),
  updated_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.reporting_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Audit (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reporting_audit_events (
  id bigserial PRIMARY KEY,
  /* 'settings' today; waivers and dispute decisions join it in P7. Text
     rather than a fixed list so a later phase adds a kind without
     altering a live constraint. */
  entity_type text NOT NULL CHECK (entity_type ~ '^[a-z][a-z0-9_]{0,59}$'),
  entity_id text,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]{0,59}$'),
  /* Not a foreign key, so deleting a user is never blocked by history and
     the row keeps who it was. */
  actor_id uuid,
  actor_label text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reporting_audit_events_entity
  ON public.reporting_audit_events (entity_type, created_at DESC);

CREATE OR REPLACE FUNCTION public.reporting_audit_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'reporting_audit_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;
REVOKE ALL ON FUNCTION public.reporting_audit_events_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reporting_audit_events_append_only_rows ON public.reporting_audit_events;
CREATE TRIGGER reporting_audit_events_append_only_rows
  BEFORE UPDATE OR DELETE ON public.reporting_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.reporting_audit_events_append_only();
DROP TRIGGER IF EXISTS reporting_audit_events_append_only_truncate ON public.reporting_audit_events;
CREATE TRIGGER reporting_audit_events_append_only_truncate
  BEFORE TRUNCATE ON public.reporting_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.reporting_audit_events_append_only();

-- ---------------------------------------------------------------------
-- 3. Notifications
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* e.g. finance.digest, finance.query_raised, reports.quotation_aged. */
  event text NOT NULL CHECK (event ~ '^[a-z][a-z0-9_.]{0,79}$'),
  /* What it is about. Not foreign keys: the subjects are FSM records and
     rows in several modules, and a notification must not vanish with them. */
  entity_type text,
  entity_id text,
  /* A deleted user's notifications go with them. SET NULL would leave an
     in-app row with no recipient, which the check below refuses, and so
     would block the deletion. */
  recipient_user_id uuid REFERENCES public.user_profile(id) ON DELETE CASCADE,
  recipient_email text,
  CONSTRAINT portal_notifications_has_recipient
    CHECK (recipient_user_id IS NOT NULL OR recipient_email IS NOT NULL),
  channel text NOT NULL CHECK (channel IN ('in_app', 'email')),
  /* Same event, same subject, same recipient, same channel = same row. */
  dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 300),
  recipient_key text GENERATED ALWAYS AS
    (coalesce(recipient_user_id::text, lower(recipient_email))) STORED,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL,
  /* A portal path only, never an external or tokenised link. */
  link text CHECK (link IS NULL OR link ~ '^/[^/]'),
  /* An item someone has to act on (verify an exclusion, answer a query)
     stays open until resolved_at is set; plain notices never need it. */
  requires_action boolean NOT NULL DEFAULT false,
  /* in_app: 'delivered' when written, 'suppressed' when the delivery
     policy held it back (a recipient outside the development allowlist).
     email: 'pending' -> 'sent' | 'failed', or 'suppressed'. */
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'sent', 'failed', 'suppressed')),
  status_reason text,
  /* Redirect mode: the address the email actually went to. */
  delivered_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  read_at timestamptz,
  resolved_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_notifications_dedupe
  ON public.portal_notifications (dedupe_key, channel, recipient_key);
/* The inbox: a user's delivered in-app notifications, newest first. */
CREATE INDEX IF NOT EXISTS idx_portal_notifications_inbox
  ON public.portal_notifications (recipient_user_id, created_at DESC)
  WHERE channel = 'in_app' AND status = 'delivered';
/* The badge. */
CREATE INDEX IF NOT EXISTS idx_portal_notifications_unread
  ON public.portal_notifications (recipient_user_id)
  WHERE channel = 'in_app' AND status = 'delivered' AND read_at IS NULL;
/* Open action items, for the home panel. */
CREATE INDEX IF NOT EXISTS idx_portal_notifications_open_actions
  ON public.portal_notifications (recipient_user_id, created_at DESC)
  WHERE channel = 'in_app' AND status = 'delivered' AND requires_action AND resolved_at IS NULL;
/* Resolving every recipient's copy of one item. */
CREATE INDEX IF NOT EXISTS idx_portal_notifications_entity
  ON public.portal_notifications (entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Server-only
-- ---------------------------------------------------------------------
ALTER TABLE public.reporting_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reporting_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_notifications ENABLE ROW LEVEL SECURITY;

/* Supabase's default privileges grant every new table to the API roles;
   take that back. With RLS on and no policy they could read nothing
   anyway, so this is the second lock, not the only one. */
REVOKE ALL ON public.reporting_settings, public.reporting_audit_events, public.portal_notifications
  FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.reporting_audit_events_id_seq FROM anon, authenticated;
