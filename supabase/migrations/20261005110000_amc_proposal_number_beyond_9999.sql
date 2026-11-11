-- =====================================================================
-- AMC proposal numbers past 9999
--
-- NOT APPLIED. Created on branch amc-hardening (5 Oct 2026); apply only
-- after review, as part of docs/database-migration-reconciliation.md.
--
-- Why
-- ---
-- 20260916105000_amc_proposal_numbers.sql set the default to
--
--   'AMC-' || to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY') || '-'
--     || lpad(nextval('amc_proposal_number_seq')::text, 4, '0')
--
-- lpad() pads AND truncates: lpad('10000', 4, '0') is '1000'. So the
-- 10,000th value would produce AMC-YYYY-1000, collide with the unique
-- index idx_amc_submissions_proposal_number, and every new proposal would
-- fail to save from then on. Production's sequence stood at 6894 on
-- 5 Oct 2026.
--
-- What this does
-- --------------
--   * Adds public.amc_next_proposal_number(), which draws the sequence
--     ONCE and pads to at least four digits without ever cutting:
--        9998 -> AMC-2026-9998      10000 -> AMC-2026-10000
--        9999 -> AMC-2026-9999      10001 -> AMC-2026-10001
--     (lib/amc/proposal-number.ts mirrors this rule and is
--     unit-tested at those four values.)
--   * Points the column default at it.
--
-- What it does not do
-- -------------------
--   * No existing proposal number changes. No row is updated.
--   * The sequence is not touched (no setval): numbering simply continues.
--   * The AMC-<year>- prefix convention is unchanged.
--
-- Rollback
-- --------
--   ALTER TABLE public.amc_submissions ALTER COLUMN proposal_number SET DEFAULT
--     ('AMC-' || to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY') || '-'
--      || lpad(nextval('public.amc_proposal_number_seq')::text, 4, '0'));
--   DROP FUNCTION IF EXISTS public.amc_next_proposal_number();
-- =====================================================================

CREATE OR REPLACE FUNCTION public.amc_next_proposal_number()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  n bigint := nextval('public.amc_proposal_number_seq');
  digits text := n::text;
BEGIN
  RETURN 'AMC-'
    || to_char(now() AT TIME ZONE 'Asia/Dubai', 'YYYY')
    || '-'
    || lpad(digits, greatest(4, length(digits)), '0');
END;
$$;

COMMENT ON FUNCTION public.amc_next_proposal_number() IS
  'Next AMC proposal number, AMC-<Dubai year>-<at least 4 digits>. Never truncates; see 20261005110000.';

-- Only the API (service role) inserts proposals; nobody else needs to
-- draw numbers. Functions are executable by PUBLIC by default.
REVOKE ALL ON FUNCTION public.amc_next_proposal_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amc_next_proposal_number() TO service_role;

ALTER TABLE public.amc_submissions
  ALTER COLUMN proposal_number SET DEFAULT public.amc_next_proposal_number();

-- ---------------------------------------------------------------------
-- Verification (read-only; run by hand after applying)
-- ---------------------------------------------------------------------
-- SELECT column_default FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'amc_submissions'
--    AND column_name = 'proposal_number';
--   -- expect: amc_next_proposal_number()
--
-- The formatting rule, without drawing from the real sequence:
-- SELECT v, 'AMC-2026-' || lpad(v::text, greatest(4, length(v::text)), '0')
--   FROM unnest(ARRAY[1, 9998, 9999, 10000, 10001]) AS v;
--   -- expect AMC-2026-0001, -9998, -9999, -10000, -10001
