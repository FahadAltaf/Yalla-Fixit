-- =====================================================================
-- AMC Proposals v2 — Phase 3: AMC Settings and the module audit trail
--
-- FR6.1  admin-only settings page
-- FR6.2  standard document text, editable without a release
-- FR6.3  standard values (TPH contact numbers, coordination emails)
-- FR6.4  a proposal already sent keeps the text it was sent with
-- FR6.5  record who changed what, and when
-- FR5.9  every status change recorded (the same table, used in phase 4)
--
-- Idempotent. Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------

/*
  One row, one JSONB document, holding only what an admin has actually
  changed.

  FR6.2 covers a lot of text: the scope of work for every service, clause
  1.1, the maintenance-team and working-hours clauses, both call-out
  clauses, materials, exclusions and termination. All of that already
  exists in amc-contract-content.ts, ~350 lines of it.

  Copying it into SQL would create a second copy to keep in step, and the
  first edit to either would make the contract depend on which one the
  renderer happened to read. So this table stores an OVERRIDE document
  instead: the code supplies the defaults, this row supplies whatever an
  admin has edited, and the resolver merges the two. An untouched install
  has an empty object here and renders exactly as it does today.

  A single JSONB column rather than a key/value table is deliberate --
  FR6.4 needs the resolved text copied onto a submission in one piece
  (see §2 below), and that is one read and one write this way.
*/
CREATE TABLE IF NOT EXISTS public.amc_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- There is one settings document, not one per anything. The constraint
  -- makes a second row impossible rather than merely unlikely.
  CONSTRAINT amc_settings_single_row CHECK (id = 1)
);

INSERT INTO public.amc_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.amc_settings ENABLE ROW LEVEL SECURITY;

/*
  No policy and no grant to anon or authenticated. Settings are read and
  written only through the admin-gated API route, which uses the
  service-role client and bypasses RLS. Deny-by-default here means a
  future route that forgets its admin check still cannot read this from
  the browser.
*/
REVOKE ALL ON public.amc_settings FROM anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. The FR6.4 snapshot
-- ---------------------------------------------------------------------

/*
  "Changes apply to new proposals. A proposal already sent keeps the text
  it was sent with."

  That rules out reading settings at render time: an admin editing a
  clause would silently rewrite every contract ever produced, including
  ones a client has already signed. So the resolved text is copied onto
  the submission when it is sent, and the document renders from the copy
  from then on.

  Null means "not sent yet" -- those render from live settings, which is
  what the team wants while they are still drafting.

  Populated in phase 5, where sending exists. Added here so the resolver
  and the settings page are built against the final shape.
*/
ALTER TABLE public.amc_submissions
  ADD COLUMN IF NOT EXISTS settings_snapshot JSONB;

COMMENT ON COLUMN public.amc_submissions.settings_snapshot IS
  'FR6.4: the fully resolved document text as at the moment this proposal was sent. NULL while it is still a draft, in which case live settings are used.';

/* FR3.1 / FR4.5 / FR4.6 — optional sections, price-list rows and the
   account managers named in clause 1.1, entered per proposal. */
ALTER TABLE public.amc_submissions
  ADD COLUMN IF NOT EXISTS document_options JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.amc_submissions.document_options IS
  'FR4.4/FR4.5/FR4.6: optionalSections, priceListRows and accountManagers for this proposal.';


-- ---------------------------------------------------------------------
-- 3. Audit trail
-- ---------------------------------------------------------------------

/*
  Append-only, mirroring snagging_audit_events including the rules that
  refuse UPDATE and DELETE -- a rule rather than a trigger, so it also
  covers writes made by the table owner.

  Serves FR6.5 (who changed what settings, and when) and FR5.9 (every
  status change, with actor, time and any reason given). One table for
  the module, matching the scheduling consolidation.
*/
CREATE TABLE IF NOT EXISTS public.amc_audit_events (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('submission', 'settings')),
  entity_id UUID,
  event_type TEXT NOT NULL,
  actor_id UUID REFERENCES public.user_profile(id) ON DELETE SET NULL,
  actor_label TEXT,
  origin TEXT NOT NULL DEFAULT 'portal' CHECK (origin IN ('portal', 'client', 'system')),
  /* FR5.2: the written reason, on every send-back. */
  justification TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amc_audit_entity
  ON public.amc_audit_events (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_amc_audit_created
  ON public.amc_audit_events (created_at DESC);

CREATE OR REPLACE RULE amc_audit_events_no_update AS
  ON UPDATE TO public.amc_audit_events DO INSTEAD NOTHING;

CREATE OR REPLACE RULE amc_audit_events_no_delete AS
  ON DELETE TO public.amc_audit_events DO INSTEAD NOTHING;

ALTER TABLE public.amc_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_audit_events FROM anon, authenticated;


-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.amc_settings)                       AS settings_rows_expect_1,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'amc_submissions'
      AND column_name IN ('settings_snapshot', 'document_options')) AS new_columns_expect_2,
  (SELECT count(*) FROM pg_rules
    WHERE tablename = 'amc_audit_events')                           AS audit_rules_expect_2;
