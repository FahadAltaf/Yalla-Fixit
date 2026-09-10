-- The rate card, as Operations issued it (Action Points F12-F22, BRD v7 §9.3).
--
-- Pricing until now was one base rate times a multiplier per property type.
-- That model cannot express the card at all: the card gives a rate per type
-- AND per furnished state, each published as a range, with a minimum charge
-- that applies when the area calculation lands below it. A villa was being
-- quoted at 1.25 AED/sq ft — outside both the 0.80–1.00 unfurnished band and
-- the 1.40 furnished rate — because 1.25 was a multiplier, not a rate anyone
-- had signed off.
--
-- The card is held as one JSONB document rather than a column per figure.
-- Operations edits it as a whole, it is snapshotted onto every quotation for
-- reproducibility, and adding a property type later is a data change instead
-- of a migration.
--
-- Every figure here is exclusive of 5% VAT (F21 / FR-2.10).

-- ---------------------------------------------------------------------
-- 1. Furnished state, which the card prices on
-- ---------------------------------------------------------------------

-- Lives on the property rather than the job: it is a fact about the unit,
-- and the quotation pulls type, furnished state, bedrooms and areas from
-- the property record (FR-2.01). Defaults false because every property on
-- the system today was quoted against the unfurnished column.
ALTER TABLE public.snagging_properties
  ADD COLUMN IF NOT EXISTS furnished boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.snagging_properties.furnished IS
  'Drives which column of the rate card applies (BRD v7 §9.3). An inspector '
  'finding this wrong on site voids the quotation (FR-2.15).';

-- ---------------------------------------------------------------------
-- 2. The card itself
-- ---------------------------------------------------------------------

ALTER TABLE public.snagging_pricing_config
  ADD COLUMN IF NOT EXISTS rate_card jsonb,
  ADD COLUMN IF NOT EXISTS out_of_hours_percent numeric NOT NULL DEFAULT 40;

COMMENT ON COLUMN public.snagging_pricing_config.rate_card IS
  'Rate card issued by Operations 21 Aug 2026 (BRD v7 §9.3). Per property '
  'type: unfurnished band [min,max], furnished rate, minimum charge, and '
  'de-snagging band. Plus the external band and the additional visit price. '
  'All figures exclusive of VAT.';

COMMENT ON COLUMN public.snagging_pricing_config.out_of_hours_percent IS
  'Surcharge on the total cost where work falls outside 09:00-17:00, on a '
  'weekend or a public holiday (F17 / FR-2.08). Added by the coordinator as '
  'a line; there is deliberately no automatic working-hours calendar (F18).';

-- Seeded only where it is still empty, so re-running never overwrites a
-- card Operations has since edited.
UPDATE public.snagging_pricing_config
SET rate_card = jsonb_build_object(
      'types', jsonb_build_object(
        'apartment', jsonb_build_object(
          'unfurnished_min', 1.20,
          'unfurnished_max', 1.40,
          'furnished',       1.50,
          'minimum_charge',  500,
          'desnag_min',      500,
          'desnag_max',      750
        ),
        -- Townhouse is priced in the villa band (F20), but it is written out
        -- in full rather than aliased: the card is data Operations edits,
        -- and a hidden alias would make a townhouse rate silently unchangeable.
        'villa', jsonb_build_object(
          'unfurnished_min', 0.80,
          'unfurnished_max', 1.00,
          'furnished',       1.40,
          'minimum_charge',  1000,
          'desnag_min',      1000,
          'desnag_max',      1000
        ),
        'townhouse', jsonb_build_object(
          'unfurnished_min', 0.80,
          'unfurnished_max', 1.00,
          'furnished',       1.40,
          'minimum_charge',  1000,
          'desnag_min',      1000,
          'desnag_max',      1000
        ),
        -- Flat 1.00 either way, so the band is a point. De-snagging is "to
        -- be confirmed" on the card and is left null rather than guessed.
        'commercial', jsonb_build_object(
          'unfurnished_min', 1.00,
          'unfurnished_max', 1.00,
          'furnished',       1.00,
          'minimum_charge',  1000,
          'desnag_min',      NULL,
          'desnag_max',      NULL
        )
      ),
      -- Plot area minus built-up area, same band furnished or not (F12).
      'external_min', 0.50,
      'external_max', 0.75,
      -- Fixed, per visit per property, after a service disconnection (F16).
      'additional_visit_price', 500
    )
WHERE rate_card IS NULL;
