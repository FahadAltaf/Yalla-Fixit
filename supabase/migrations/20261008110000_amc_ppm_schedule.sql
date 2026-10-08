-- =====================================================================
-- AMC PPM schedule: visits, visit lines, service windows, clubbing
-- (BRD v0.3 5.10; DEV-354, 388, 389, 390)
-- =====================================================================
-- NOT APPLIED. Row 22 in docs/production-migration-log.md, checks §14.
--
-- What it adds
--   * amc_visits: one planned visit -- its cycle, the service window inside
--     the cycle, the target date (and the original one once moved outside
--     the window, for adherence) and one of the twelve visit statuses.
--   * amc_visit_lines: what the visit does, one row per service line (a
--     trade or entitlement). A clubbed visit has several lines; each keeps
--     the window it was generated with, so separating it restores that,
--     and each carries its own completion.
--   * amc_visit_changes: the schedule's history (generated, moved inside
--     its window, rescheduled outside it, added, removed, clubbed,
--     separated, confirmed), append-only.
--   * amc_contracts: the confirmed plan of record (who, when), the window
--     length and the appointment-attempt rule per contract (BRD 5.11:
--     three attempts two days apart by default), and the overdue stamp.
--   * amc_fsm_links.visit_id: an FSM appointment links to the visit it
--     carries out (issue #6), not only to an entitlement.
--
-- Live safety
--   Branch-only tables (live main reads none of them); amc_submissions is
--   not touched. Additive and idempotent; RLS on, nothing granted to the
--   browser roles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The contract: plan of record, window and attempt rule
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_contracts
  ADD COLUMN IF NOT EXISTS ppm_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ppm_confirmed_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  /* Null: AMC configuration's service window (15 days by default). */
  ADD COLUMN IF NOT EXISTS ppm_window_days integer CHECK (ppm_window_days IS NULL OR ppm_window_days BETWEEN 1 AND 120),
  /* Null: AMC configuration's attempt rule. */
  ADD COLUMN IF NOT EXISTS attempt_count integer CHECK (attempt_count IS NULL OR attempt_count BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS attempt_interval_days integer CHECK (attempt_interval_days IS NULL OR attempt_interval_days BETWEEN 0 AND 30),
  ADD COLUMN IF NOT EXISTS attempt_channels text[]
    CHECK (attempt_channels IS NULL OR attempt_channels <@ ARRAY['whatsapp', 'call', 'sms', 'email']::text[]),
  ADD COLUMN IF NOT EXISTS attempt_escalation_user_id uuid REFERENCES public.user_profile(id) ON DELETE SET NULL;
ALTER TABLE public.amc_contracts DROP CONSTRAINT IF EXISTS amc_contracts_ppm_confirmed_shape;
ALTER TABLE public.amc_contracts
  ADD CONSTRAINT amc_contracts_ppm_confirmed_shape CHECK (ppm_confirmed_by IS NULL OR ppm_confirmed_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_amc_contracts_ppm_confirmed_by
  ON public.amc_contracts (ppm_confirmed_by) WHERE ppm_confirmed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_contracts_attempt_escalation
  ON public.amc_contracts (attempt_escalation_user_id) WHERE attempt_escalation_user_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Visits
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  visit_no integer NOT NULL CHECK (visit_no >= 1),
  status text NOT NULL DEFAULT 'not_scheduled' CHECK (status IN (
    'not_scheduled', 'scheduled', 'confirmed', 'in_progress', 'submitted', 'completed',
    'completed_with_additional_work', 'partially_completed', 'pending_access', 'rescheduled',
    'not_completed', 'cancelled'
  )),
  /* The cycle the visit belongs to, and the window inside it (BRD 5.10). */
  cycle_start date NOT NULL,
  cycle_end date NOT NULL,
  window_start date NOT NULL,
  window_end date NOT NULL,
  target_date date NOT NULL,
  /* Set the first time the visit is moved outside its window after the
     plan was confirmed: adherence is measured against it. */
  original_target_date date,
  reschedule_count integer NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0),
  source text NOT NULL DEFAULT 'generated' CHECK (source IN ('generated', 'added', 'separated')),
  status_reason text,
  /* Not Completed / Partially Completed carry a reason in one of five groups (BRD 5.11; Phase 10). */
  outcome_group text CHECK (outcome_group IS NULL OR outcome_group IN ('client', 'internal', 'material', 'access', 'partial')),
  overdue_notified_at timestamptz,
  created_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_visits_no_unique UNIQUE (contract_id, visit_no),
  CONSTRAINT amc_visits_cycle_order CHECK (cycle_start <= cycle_end),
  CONSTRAINT amc_visits_window_order CHECK (window_start <= window_end),
  CONSTRAINT amc_visits_cancel_explained CHECK (
    status <> 'cancelled' OR (status_reason IS NOT NULL AND length(trim(status_reason)) > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_amc_visits_open_window
  ON public.amc_visits (window_end) WHERE status NOT IN ('completed', 'completed_with_additional_work', 'cancelled', 'not_completed');
CREATE INDEX IF NOT EXISTS idx_amc_visits_target ON public.amc_visits (target_date);
CREATE INDEX IF NOT EXISTS idx_amc_visits_created_by ON public.amc_visits (created_by) WHERE created_by IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Visit lines (per trade / entitlement; completion per trade)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_visit_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.amc_visits(id) ON DELETE RESTRICT,
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  entitlement_id uuid NOT NULL REFERENCES public.amc_contract_entitlements(id) ON DELETE RESTRICT,
  service_id text NOT NULL,
  service_label text NOT NULL,
  /* The nth visit of this service line over the contract. */
  occurrence integer NOT NULL CHECK (occurrence >= 1),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'partially_completed', 'not_completed', 'cancelled')),
  /* The window the line was generated with: separating a clubbed line restores it. */
  home_cycle_start date NOT NULL,
  home_cycle_end date NOT NULL,
  home_window_start date NOT NULL,
  home_window_end date NOT NULL,
  home_target_date date NOT NULL,
  status_reason text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_visit_lines_occurrence_unique UNIQUE (entitlement_id, occurrence),
  CONSTRAINT amc_visit_lines_home_window CHECK (home_window_start <= home_window_end)
);
CREATE INDEX IF NOT EXISTS idx_amc_visit_lines_visit ON public.amc_visit_lines (visit_id);
CREATE INDEX IF NOT EXISTS idx_amc_visit_lines_contract ON public.amc_visit_lines (contract_id);

-- ---------------------------------------------------------------------
-- 4. The schedule's history (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_visit_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.amc_contracts(id) ON DELETE RESTRICT,
  visit_id uuid REFERENCES public.amc_visits(id) ON DELETE RESTRICT,
  change_type text NOT NULL CHECK (change_type IN (
    'generated', 'adjusted', 'moved_in_window', 'rescheduled', 'added', 'removed', 'clubbed', 'separated', 'confirmed', 'rules_changed'
  )),
  from_date date,
  to_date date,
  reason text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  actor_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amc_visit_changes_reason_where_needed CHECK (
    change_type NOT IN ('rescheduled', 'added', 'removed') OR (reason IS NOT NULL AND length(trim(reason)) > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_amc_visit_changes_contract ON public.amc_visit_changes (contract_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amc_visit_changes_visit ON public.amc_visit_changes (visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_visit_changes_actor ON public.amc_visit_changes (actor_id) WHERE actor_id IS NOT NULL;
DROP TRIGGER IF EXISTS amc_visit_changes_locked ON public.amc_visit_changes;
CREATE TRIGGER amc_visit_changes_locked
  BEFORE UPDATE OR DELETE ON public.amc_visit_changes
  FOR EACH ROW EXECUTE FUNCTION public.amc_history_row_locked();

-- ---------------------------------------------------------------------
-- 5. An FSM appointment carries out a visit (issue #6)
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_fsm_links
  ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.amc_visits(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_amc_fsm_links_visit ON public.amc_fsm_links (visit_id) WHERE visit_id IS NOT NULL;

-- Server-only, like every AMC table.
ALTER TABLE public.amc_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_visit_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_visit_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_visits FROM anon, authenticated;
REVOKE ALL ON public.amc_visit_lines FROM anon, authenticated;
REVOKE ALL ON public.amc_visit_changes FROM anon, authenticated;
