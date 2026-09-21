-- The coordinator chooses the rate inside the band, and the system records
-- who chose it (FR-2.04, FR-2.05; Sami, 16 Sep 2026).
--
-- The card publishes a range per property type, and until now the system
-- picked a point inside it on its own, by size. The direction of that
-- rule is right and stays — smaller properties pay toward the top of the
-- band — but it becomes a SUGGESTION. A person decides, and the record
-- says who, because this is the number a client is charged and "the
-- system worked it out" is not an answer anybody can defend later.
--
-- Going outside the band is allowed, and gated: it needs a reason when it
-- is chosen and an admin before the quotation can be sent. The gate is on
-- SENDING rather than on saving, because sending is the outward-facing
-- act — a draft priced off-band is a proposal somebody is still thinking
-- about, not a promise made to a client.

ALTER TABLE public.snagging_quotations
  ADD COLUMN IF NOT EXISTS rate_per_sqft numeric,
  ADD COLUMN IF NOT EXISTS rate_suggested numeric,
  ADD COLUMN IF NOT EXISTS rate_chosen_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rate_chosen_at timestamptz,
  ADD COLUMN IF NOT EXISTS rate_outside_band boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rate_override_reason text,
  ADD COLUMN IF NOT EXISTS rate_approved_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rate_approved_at timestamptz;

COMMENT ON COLUMN public.snagging_quotations.rate_per_sqft IS
  'The built-up rate this quotation was actually priced at. Null on any '
  'quotation raised before the coordinator made the choice (FR-2.04).';

COMMENT ON COLUMN public.snagging_quotations.rate_suggested IS
  'What the size rule proposed, kept beside the choice so a later reader '
  'can see whether the coordinator moved it and by how much.';

COMMENT ON COLUMN public.snagging_quotations.rate_outside_band IS
  'True when the chosen rate sits outside the card band for this property '
  'type. Such a quotation cannot be sent until an admin approves it.';

/*
  A reason is not optional when the rate leaves the band.

  Enforced here rather than only in the API: an off-band price with no
  stated reason is exactly the row somebody has to explain in six months,
  and by then whoever chose it has left.
*/
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'snagging_quotations_rate_override_reason_check'
  ) THEN
    ALTER TABLE public.snagging_quotations
      ADD CONSTRAINT snagging_quotations_rate_override_reason_check
      CHECK (
        rate_outside_band = false
        OR (rate_override_reason IS NOT NULL AND length(btrim(rate_override_reason)) > 0)
      );
  END IF;

  /* An approval names an approver and a moment, or neither. */
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'snagging_quotations_rate_approval_check'
  ) THEN
    ALTER TABLE public.snagging_quotations
      ADD CONSTRAINT snagging_quotations_rate_approval_check
      CHECK ((rate_approved_by IS NULL) = (rate_approved_at IS NULL));
  END IF;
END $$;

-- "Which quotations are waiting on an admin?" is the one query this adds.
CREATE INDEX IF NOT EXISTS snagging_quotations_rate_pending_idx
  ON public.snagging_quotations (rate_outside_band)
  WHERE rate_outside_band = true AND rate_approved_at IS NULL;
