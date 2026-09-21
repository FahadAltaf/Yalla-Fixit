-- The external-areas rate is the coordinator's choice too
-- (FR-2.04, FR-2.07; Sami, 16 Sep 2026 — "both the same way").
--
-- Run AFTER 20260916140000_quotation_rate_choice.sql.
--
-- The card publishes two ranges, not one: an inspection rate per sq ft of
-- built-up area, and a separate rate for external areas — the plot beyond
-- the building, charged on villas and townhouses. The first became a
-- choice in the earlier migration; this is the second, on the same terms.
--
-- A villa with a large garden is a different conversation from the unit
-- inside it, which is why the two are chosen separately rather than one
-- decision being applied to both.

ALTER TABLE public.snagging_quotations
  ADD COLUMN IF NOT EXISTS external_rate_per_sqft numeric,
  ADD COLUMN IF NOT EXISTS external_rate_suggested numeric;

COMMENT ON COLUMN public.snagging_quotations.external_rate_per_sqft IS
  'The external-areas rate this quotation was priced at (FR-2.07). Null '
  'where the property has no external areas in scope, which is most of '
  'them.';

COMMENT ON COLUMN public.snagging_quotations.external_rate_suggested IS
  'What the size rule proposed for the external areas, kept beside the '
  'choice so a later reader can see whether it was moved.';

/*
  `rate_outside_band` stays ONE flag for the whole document.

  It is already true when the built-up rate leaves its band, and it now
  also covers the external one. The approval is of this quotation's
  pricing rather than of a single line: an admin asked to sign a price off
  should not have to be told which of two numbers triggered it, and two
  independent gates would allow a half-approved quotation to be sent.

  So there is nothing to add here — the existing flag, reason, approver
  and timestamp all carry over unchanged.
*/
