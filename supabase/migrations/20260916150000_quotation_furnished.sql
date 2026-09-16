-- Furnished is declared on the QUOTATION, not stored on the unit
-- (FR-1.07, FR-2.15; Sami, 16 Sep 2026: "whatever the client declares at
-- quotation").
--
-- It used to be read from snagging_properties.furnished. Two things were
-- wrong with that:
--
--   1. The column was never written. It is absent from the property
--      upsert schema and from propertyColumns(), so nothing in the
--      portal could set it and every row in this database reads false —
--      which means every quotation issued so far was priced as
--      unfurnished, whatever the client actually said.
--
--   2. Even fixed, the unit is the wrong owner. A property can be let
--      furnished to one client and empty to the next, and the rate is a
--      function of what is being inspected on the day, not of the unit
--      in the abstract. The declaration belongs to the document that
--      charges for it.
--
-- The property column is left alone rather than dropped: it costs
-- nothing, and a future property form may legitimately want to carry a
-- default for the coordinator to start from.

ALTER TABLE public.snagging_quotations
  ADD COLUMN IF NOT EXISTS furnished boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.snagging_quotations.furnished IS
  'What the client declared when this quotation was raised (FR-2.15). '
  'Drives which side of the rate card applies. Commercial is a flat rate '
  'either way, so it is ignored there. If the inspector finds it wrong on '
  'site the quotation is void and a revised one is needed (FR-4.17).';

/*
  Existing quotations keep the answer they were priced with.

  Every one of them was priced against property.furnished, which is false
  on every row — so false is not a guess here, it is what the stored
  totals were actually calculated from. Backfilling anything else would
  make the column disagree with the money on the document.
*/
UPDATE public.snagging_quotations
   SET furnished = COALESCE((property_snapshot ->> 'furnished')::boolean, false)
 WHERE property_snapshot IS NOT NULL;
