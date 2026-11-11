-- =====================================================================
-- AMC platform foundation (BRD v0.3 Phase 1: DEV-357, 418, 419, 421, 423, 424)
--
-- NOT APPLIED. Branch amc-hardening, 7 Oct 2026.
-- SAFE BEFORE CODE DEPLOY. Checked against origin/main, 7 Oct 2026:
--   * amc_config, amc_todos and amc_job_runs are new; live `main` never
--     reads them.
--   * amc_audit_events (live): its entity-type CHECK becomes a name
--     pattern. Every value live `main` writes ('submission', 'settings')
--     still matches.
--   * amc_notifications: new on this branch (not used by `main`); its
--     event CHECK becomes a name pattern, so later phases add events in
--     code only. Two nullable columns are added.
--   * todos (live): the related-type CHECK also allows 'amc_…' types. Live
--     `main` shows a related type as plain text, so new values display.
-- Idempotent: safe to run twice.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Configuration (DEV-357): one row per section, defaults in code
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_config (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-zA-Z0-9]{1,59}$'),
  value jsonb NOT NULL,
  updated_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.amc_config IS
  'AMC configuration sections (lib/amc/config.ts). Only saved sections are stored; every change is audited in amc_audit_events (entity_type config).';

-- ---------------------------------------------------------------------
-- 2. AMC to-dos (DEV-423): the link between an AMC record and its Todo
--    in the existing Todos module, with idempotency and escalation
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* One of the 8 BRD to-dos, e.g. proposal_approval, ppm_confirmation. */
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z_]{2,40}$'),
  entity_type text NOT NULL CHECK (entity_type ~ '^[a-z][a-z_]{1,39}$'),
  entity_id uuid NOT NULL,
  /* Same kind, same record, same step = same to-do (a retry writes nothing). */
  dedupe_key text NOT NULL UNIQUE CHECK (length(dedupe_key) BETWEEN 1 AND 300),
  todo_id uuid REFERENCES public.todos(id) ON DELETE SET NULL,
  due_at timestamptz,
  escalate_at timestamptz,
  escalated_at timestamptz,
  escalation_level integer NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 5),
  closed_at timestamptz,
  close_reason text,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_amc_todos_entity ON public.amc_todos (entity_type, entity_id);
/* The Todo side of the link (also lets a deleted Todo null the link quickly). */
CREATE INDEX IF NOT EXISTS idx_amc_todos_todo ON public.amc_todos (todo_id);
/* The escalation sweep: open, due to escalate, not yet escalated at this level. */
CREATE INDEX IF NOT EXISTS idx_amc_todos_escalation
  ON public.amc_todos (escalate_at) WHERE closed_at IS NULL AND escalated_at IS NULL;

-- ---------------------------------------------------------------------
-- 3. Scheduled job runs (/api/amc-jobs/run): what ran, when, with what result
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  actor_id uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  /* { "<job>": { "ok": true, "result": {...} } } */
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_amc_job_runs_started ON public.amc_job_runs (started_at DESC);

-- ---------------------------------------------------------------------
-- 4. Audit (DEV-424): entity types by name pattern, so every new AMC
--    record (enquiry, visit, call out, payment…) is audited without a
--    migration each time
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_audit_events DROP CONSTRAINT IF EXISTS amc_audit_events_entity_type_check;
ALTER TABLE public.amc_audit_events
  ADD CONSTRAINT amc_audit_events_entity_type_check
  CHECK (entity_type ~ '^[a-z][a-z_]{1,39}$');

-- ---------------------------------------------------------------------
-- 5. Notifications (DEV-421): event names by pattern; any AMC record
-- ---------------------------------------------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.amc_notifications'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%event%IN%'
  LOOP
    EXECUTE format('ALTER TABLE public.amc_notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.amc_notifications DROP CONSTRAINT IF EXISTS amc_notifications_event_name;
ALTER TABLE public.amc_notifications
  ADD CONSTRAINT amc_notifications_event_name CHECK (event ~ '^[a-z][a-z_]{2,60}$');
ALTER TABLE public.amc_notifications
  ADD COLUMN IF NOT EXISTS entity_type text CHECK (entity_type IS NULL OR entity_type ~ '^[a-z][a-z_]{1,39}$'),
  ADD COLUMN IF NOT EXISTS entity_id uuid;
CREATE INDEX IF NOT EXISTS idx_amc_notifications_entity
  ON public.amc_notifications (entity_type, entity_id) WHERE entity_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 6. Todos (live): allow 'amc_…' related types
-- ---------------------------------------------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.todos'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%related_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.todos DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.todos
  ADD CONSTRAINT todos_related_type_check CHECK (
    related_type IS NULL
    OR related_type IN ('work_order', 'quotation', 'appointment', 'amc_contract')
    OR related_type ~ '^amc_[a-z_]{2,40}$'
  );

-- ---------------------------------------------------------------------
-- Access: service role only (the portal API)
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_job_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_config, public.amc_todos, public.amc_job_runs FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Rollback:
--   DROP TABLE public.amc_job_runs; DROP TABLE public.amc_todos; DROP TABLE public.amc_config;
--   ALTER TABLE public.amc_audit_events DROP CONSTRAINT amc_audit_events_entity_type_check;
--   ALTER TABLE public.amc_audit_events ADD CONSTRAINT amc_audit_events_entity_type_check
--     CHECK (entity_type IN ('submission', 'settings', 'contract', 'assessment', 'customer', 'quote'));
--   ALTER TABLE public.amc_notifications DROP CONSTRAINT amc_notifications_event_name;
--   ALTER TABLE public.amc_notifications DROP COLUMN entity_type, DROP COLUMN entity_id;
--   ALTER TABLE public.todos DROP CONSTRAINT todos_related_type_check;
--   ALTER TABLE public.todos ADD CONSTRAINT todos_related_type_check CHECK (related_type IS NULL
--     OR related_type IN ('work_order', 'quotation', 'appointment', 'amc_contract'));
-- (Rolling back the two CHECKs fails if rows of the new kinds exist.)
-- ---------------------------------------------------------------------
