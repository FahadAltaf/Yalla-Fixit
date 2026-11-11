-- =====================================================================
-- AMC approval ladder, send log and the client's decision
-- (BRD v0.3 Phase 5: DEV-369, 370, 371, 420 Email 1, 423 to-do #1)
--
-- NOT APPLIED. Branch amc-hardening, 7 Oct 2026.
-- SAFE BEFORE CODE DEPLOY. Checked against origin/main, 7 Oct 2026:
--   * amc_approval_steps and amc_send_log are new;
--   * amc_submissions (LIVE) only gains nullable columns. Live main
--     selects `*`, inserts and updates its own fields, and keeps writing
--     client_decision 'approved' / 'rejected' as before; the new
--     client_answer only adds "revision requested" beside it.
-- Apply after 20261007140000. Idempotent: safe to run twice.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The ladder (DEV-369, BRD 5.5): on share, the four triggers decide
--    the highest level needed; levels 1..N decide in sequence. One row per
--    level per round (a returned or rejected proposal starts a new round
--    when it is shared again) per version.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.amc_submissions(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no >= 1),
  round integer NOT NULL DEFAULT 1 CHECK (round >= 1),
  level integer NOT NULL CHECK (level BETWEEN 1 AND 3),
  level_name text NOT NULL,
  /* The approvers named for the level when the step opened (empty: the AMC approvers decide). */
  approver_ids uuid[] NOT NULL DEFAULT '{}',
  /* What was crossed: [{ key, level, detail }]. */
  triggers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(triggers) = 'array'),
  /* waiting: a lower level has not decided yet. */
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'approved', 'rejected', 'returned', 'cancelled')),
  opened_at timestamptz,
  escalate_at timestamptz,
  decided_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  decided_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, version_no, round, level),
  CONSTRAINT amc_approval_steps_decided CHECK (status NOT IN ('approved', 'rejected', 'returned') OR decided_at IS NOT NULL),
  CONSTRAINT amc_approval_steps_reason CHECK (status NOT IN ('rejected', 'returned') OR length(trim(coalesce(comment, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS idx_amc_approval_steps_open ON public.amc_approval_steps (submission_id, status);
CREATE INDEX IF NOT EXISTS idx_amc_approval_steps_pending ON public.amc_approval_steps (escalate_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_amc_approval_steps_decided_by ON public.amc_approval_steps (decided_by) WHERE decided_by IS NOT NULL;
/* One level open at a time per proposal. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_approval_steps_one_pending ON public.amc_approval_steps (submission_id) WHERE status = 'pending';

-- ---------------------------------------------------------------------
-- 2. The send log (DEV-370, BRD 5.6): channel, recipients, version, user, time.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.amc_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.amc_submissions(id) ON DELETE RESTRICT,
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  document text NOT NULL CHECK (document IN ('proposal', 'contract')),
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'link', 'sms')),
  /* [{ name, address }]: emails for email, phone numbers for WhatsApp. */
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recipients) = 'array'),
  cc text[] NOT NULL DEFAULT '{}',
  outcome text NOT NULL CHECK (outcome IN ('sent', 'prepared', 'link_created', 'failed', 'no_recipient')),
  token_hint text,
  detail text,
  sent_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_amc_send_log_submission ON public.amc_send_log (submission_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_amc_send_log_sent_by ON public.amc_send_log (sent_by) WHERE sent_by IS NOT NULL;

DROP TRIGGER IF EXISTS amc_send_log_locked ON public.amc_send_log;
CREATE TRIGGER amc_send_log_locked
  BEFORE UPDATE OR DELETE ON public.amc_send_log
  FOR EACH ROW EXECUTE FUNCTION public.amc_history_row_locked();

-- ---------------------------------------------------------------------
-- 3. The client's decision (DEV-370, 371): the third answer, and who
--    recorded an answer given outside the link, with its evidence.
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_submissions
  ADD COLUMN IF NOT EXISTS client_answer text CHECK (client_answer IS NULL OR client_answer IN ('approved', 'rejected', 'revision_requested')),
  ADD COLUMN IF NOT EXISTS client_answer_source text CHECK (client_answer_source IS NULL OR client_answer_source IN ('link', 'coordinator')),
  ADD COLUMN IF NOT EXISTS client_answer_recorded_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_answer_evidence_id uuid REFERENCES public.amc_documents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_amc_submissions_answer_recorded_by ON public.amc_submissions (client_answer_recorded_by) WHERE client_answer_recorded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amc_submissions_answer_evidence ON public.amc_submissions (client_answer_evidence_id) WHERE client_answer_evidence_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. Server-only.
-- ---------------------------------------------------------------------
ALTER TABLE public.amc_approval_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amc_send_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_approval_steps, public.amc_send_log FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- Rollback (only before any step or send is recorded):
--   ALTER TABLE public.amc_submissions DROP COLUMN IF EXISTS client_answer, DROP COLUMN IF EXISTS client_answer_source,
--     DROP COLUMN IF EXISTS client_answer_recorded_by, DROP COLUMN IF EXISTS client_answer_evidence_id;
--   DROP TABLE IF EXISTS public.amc_send_log;
--   DROP TABLE IF EXISTS public.amc_approval_steps;
-- ---------------------------------------------------------------------
