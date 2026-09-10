/**
 * Quotation pricing, against the rate card Operations issued on 21 August
 * 2026 (Action Points F12–F22, BRD v7 §9.3 and FR-2.03 → FR-2.10).
 *
 * Snagging is priced per square foot of built-up area. The rate comes from
 * the card by property type and furnished state; villas and townhouses with
 * external areas in scope carry a second line charged on plot area minus
 * built-up area; and every type carries a minimum charge that applies when
 * the area calculation lands below it.
 *
 * This replaced a base-rate-times-multiplier model that could not express
 * the card. Under it a villa quoted at 1.25 AED/sq ft, which is outside the
 * 0.80–1.00 unfurnished band and below the 1.40 furnished rate — a figure
 * nobody had signed off, arrived at by multiplication.
 *
 * Every figure is exclusive of VAT (F21). The card lives in
 * `snagging_pricing_config.rate_card`, admin-editable only (FR-2.11).
 */

/** One property type's row on the card. */
export type RateCardType = {
  unfurnished_min: number;
  unfurnished_max: number;
  furnished: number;
  minimum_charge: number;
  /** Null where the card says "to be confirmed", as it does for commercial. */
  desnag_min: number | null;
  desnag_max: number | null;
};

export type RateCard = {
  types: Record<string, RateCardType>;
  external_min: number;
  external_max: number;
  additional_visit_price: number;
};

export type PricingConfig = {
  currency: string;
  tax_rate: number;
  rate_card: RateCard | null;
  out_of_hours_percent: number;
  scope_of_work: string | null;
  terms: string | null;
  /*
    The superseded model. Read by nothing that prices a job — it is kept on
    the type so quotations raised before the card can still be rendered from
    their own snapshot without the renderer needing a second shape.
  */
  rate_per_sqft?: number;
  external_rate_per_sqft?: number;
  multipliers?: Record<string, number>;
  desnag_price?: number;
  additional_visit_price?: number;
};

export type QuoteLine = {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  amount: number;
};

export type QuoteJob = {
  property_type: string | null;
  built_up_area_sqft: number | null;
  plot_area_sqft: number | null;
  external_areas_in_scope: boolean | null;
  bedrooms: number | null;
  furnished?: boolean | null;
};

const TYPE_LABEL: Record<string, string> = {
  apartment: "Apartment",
  villa: "Villa",
  townhouse: "Townhouse",
  commercial: "Commercial",
};

/**
 * Where the size brackets will go.
 *
 * The card publishes most rates as a range, and the rule for choosing
 * inside it is size: smaller properties toward the higher end, larger
 * toward the lower end. Age, developer and condition do not move it (F22).
 *
 * FR-2.05 asks that the range model be held so fixed size brackets can
 * replace the choice later without a rebuild, which is exactly what this
 * is — one function, taking the band and the area, returning the rate. Swap
 * the interpolation for a bracket table and nothing around it changes.
 *
 * Interpolating between these two anchors is the honest reading of "smaller
 * toward the higher end": below 800 sq ft you pay the top of the band, above
 * 4,000 you pay the bottom, and in between it slides.
 */
const SMALL_SQFT = 800;
const LARGE_SQFT = 4000;

export function pickRateForSize(min: number, max: number, sqft: number): number {
  if (max <= min) return min;
  if (!Number.isFinite(sqft) || sqft <= 0) return round2((min + max) / 2);
  if (sqft <= SMALL_SQFT) return max;
  if (sqft >= LARGE_SQFT) return min;
  const position = (sqft - SMALL_SQFT) / (LARGE_SQFT - SMALL_SQFT);
  return round2(max - position * (max - min));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** The card's row for a type, falling back to apartment for anything unknown. */
export function rateCardFor(
  card: RateCard,
  type: string,
): RateCardType | null {
  return card.types?.[type] ?? card.types?.apartment ?? null;
}

/** The de-snagging charge for a property type, or null where unpublished. */
export function desnagPrice(card: RateCard, type: string): number | null {
  const row = rateCardFor(card, type);
  if (!row || row.desnag_min == null) return null;
  // Published as a range for apartments (500–750). Nothing in either
  // document ties that range to size the way F22 ties the per-sq-ft rates,
  // so the lower bound is quoted and Operations moves it if they want to.
  return row.desnag_min;
}

/**
 * Builds the priced lines for a job's snagging inspection.
 *
 * `outOfHours` adds the surcharge as its own line, which is the coordinator's
 * call rather than something derived from a calendar (F17, F18, FR-2.08).
 */
export function computeQuotation(
  job: QuoteJob,
  config: PricingConfig,
  options: { outOfHours?: boolean } = {},
) {
  const lines: QuoteLine[] = [];
  const type = job.property_type ?? "apartment";
  const bua = Number(job.built_up_area_sqft) || 0;
  const card = config.rate_card;
  const row = card ? rateCardFor(card, type) : null;

  if (!card || !row) {
    // Nothing to price against. Returning empty rather than falling back to
    // the old multiplier keeps a mispriced quotation from being issued
    // quietly; the caller surfaces "pricing is not configured".
    return summarise(lines, config, { minimumApplied: false });
  }

  // 1. Built-up area, at the card rate for this type and furnished state.
  const furnished = job.furnished === true;
  const buaRate = furnished
    ? row.furnished
    : pickRateForSize(row.unfurnished_min, row.unfurnished_max, bua);

  const bedrooms =
    type === "commercial"
      ? null
      : job.bedrooms === 0
        ? "Studio"
        : job.bedrooms != null
          ? `${job.bedrooms} BR`
          : null;

  // Commercial is a flat rate either way, so saying "unfurnished" on the
  // line would describe a distinction the card does not make for it.
  const state = type === "commercial" ? null : furnished ? "furnished" : "unfurnished";

  lines.push({
    description: `Snagging inspection: ${TYPE_LABEL[type] ?? type}${
      bedrooms ? `, ${bedrooms}` : ""
    }${state ? `, ${state}` : ""} (${bua} sq ft)`,
    qty: bua,
    unit: "sq ft",
    unit_price: buaRate,
    amount: round2(bua * buaRate),
  });

  // 2. External areas (F12 / FR-2.07), villas and townhouses only.
  if (
    (type === "villa" || type === "townhouse") &&
    job.external_areas_in_scope &&
    Number(job.plot_area_sqft) > bua
  ) {
    const external = round2(Number(job.plot_area_sqft) - bua);
    const externalRate = pickRateForSize(
      card.external_min,
      card.external_max,
      external,
    );
    lines.push({
      description: `External areas (plot ${Number(job.plot_area_sqft)} − built-up ${bua})`,
      qty: external,
      unit: "sq ft",
      unit_price: externalRate,
      amount: round2(external * externalRate),
    });
  }

  /*
    3. The minimum charge (F14, F20 / FR-2.06).

    Written as a top-up line rather than by silently rewriting the rate,
    because a client comparing the quotation against the rate card has to be
    able to see both: the area calculation they expected, and the floor that
    lifted it. Rewriting the per-sq-ft rate to make the arithmetic land on
    the minimum would produce a rate that appears nowhere on the card.
  */
  const beforeMinimum = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const minimum = Number(row.minimum_charge) || 0;
  let minimumApplied = false;

  if (minimum > 0 && beforeMinimum < minimum) {
    const topUp = round2(minimum - beforeMinimum);
    lines.push({
      description: `Minimum charge adjustment (${TYPE_LABEL[type] ?? type} minimum ${minimum})`,
      qty: 1,
      unit: "job",
      unit_price: topUp,
      amount: topUp,
    });
    minimumApplied = true;
  }

  // 4. Out of hours (F17 / FR-2.08), on the total cost of the service.
  const percent = Number(config.out_of_hours_percent) || 0;
  if (options.outOfHours && percent > 0) {
    const base = round2(lines.reduce((sum, l) => sum + l.amount, 0));
    const surcharge = round2((base * percent) / 100);
    lines.push({
      description: `Out of hours surcharge (${percent}%)`,
      qty: 1,
      unit: "job",
      unit_price: surcharge,
      amount: surcharge,
    });
  }

  return summarise(lines, config, { minimumApplied });
}

export function summarise(
  lines: QuoteLine[],
  config: Pick<PricingConfig, "tax_rate" | "currency">,
  meta: { minimumApplied?: boolean } = {},
) {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const taxAmount = round2((subtotal * config.tax_rate) / 100);
  const total = round2(subtotal + taxAmount);
  return {
    lines,
    subtotal,
    tax_rate: config.tax_rate,
    tax_amount: taxAmount,
    total,
    currency: config.currency,
    minimum_applied: meta.minimumApplied ?? false,
  };
}
