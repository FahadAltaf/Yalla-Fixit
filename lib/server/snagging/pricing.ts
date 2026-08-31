/**
 * Quotation pricing (Action Points F1, F2, F12).
 *
 * Snagging is priced per square foot of built-up area, times a multiplier
 * that varies by property type. Villas and townhouses with external areas
 * in scope carry a second line charged on plot area minus built-up area.
 * The formula lives in `snagging_pricing_config`, admin editable only.
 */
export type PricingConfig = {
  currency: string;
  rate_per_sqft: number;
  external_rate_per_sqft: number;
  multipliers: Record<string, number>;
  tax_rate: number;
  desnag_price: number;
  additional_visit_price: number;
  scope_of_work: string | null;
  terms: string | null;
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
};

const TYPE_LABEL: Record<string, string> = {
  apartment: "Apartment",
  villa: "Villa",
  townhouse: "Townhouse",
  commercial: "Commercial",
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Builds the priced lines for a job's snagging inspection. */
export function computeQuotation(job: QuoteJob, config: PricingConfig) {
  const lines: QuoteLine[] = [];
  const type = job.property_type ?? "apartment";
  const multiplier = config.multipliers?.[type] ?? 1;
  const bua = Number(job.built_up_area_sqft) || 0;

  // 1. Built-up area line.
  const buaRate = round2(config.rate_per_sqft * multiplier);
  const bedrooms =
    type === "commercial"
      ? null
      : job.bedrooms === 0
        ? "Studio"
        : job.bedrooms != null
          ? `${job.bedrooms} BR`
          : null;
  lines.push({
    description: `Snagging inspection — ${TYPE_LABEL[type] ?? type}${bedrooms ? `, ${bedrooms}` : ""} (${bua} sq ft)`,
    qty: bua,
    unit: "sq ft",
    unit_price: buaRate,
    amount: round2(bua * buaRate),
  });

  // 2. External area line (F12) for villas/townhouses in scope.
  if (
    (type === "villa" || type === "townhouse") &&
    job.external_areas_in_scope &&
    Number(job.plot_area_sqft) > bua &&
    config.external_rate_per_sqft > 0
  ) {
    const external = round2(Number(job.plot_area_sqft) - bua);
    lines.push({
      description: `External areas (plot ${Number(job.plot_area_sqft)} − built-up ${bua})`,
      qty: external,
      unit: "sq ft",
      unit_price: config.external_rate_per_sqft,
      amount: round2(external * config.external_rate_per_sqft),
    });
  }

  return summarise(lines, config);
}

export function summarise(lines: QuoteLine[], config: PricingConfig) {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const taxAmount = round2((subtotal * config.tax_rate) / 100);
  const total = round2(subtotal + taxAmount);
  return { lines, subtotal, tax_rate: config.tax_rate, tax_amount: taxAmount, total, currency: config.currency };
}
