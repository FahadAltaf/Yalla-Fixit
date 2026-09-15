import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeQuotation,
  desnagPrice,
  summarise,
  type PricingConfig,
  type QuoteJob,
} from "@/lib/server/snagging/pricing";

/**
 * Prices one property into the columns a quotation row is made of.
 *
 * Pulled out of the job-scoped route because a quotation can now be raised
 * before any job exists (BA v2, change 1). Two routes build quotations —
 * the Quotations section, which starts from a client and a property, and
 * the job's own tab, which still quotes an additional visit — and they
 * have to produce byte-identical documents from the same inputs. One
 * function is the only way to guarantee that; two would drift the first
 * time a figure moved.
 */

type Admin = SupabaseClient;

export type QuotedProperty = QuoteJob & {
  unit_label?: string | null;
  building_name?: string | null;
  community?: string | null;
  developer_name?: string | null;
};

export type QuotedClient = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

/** Everything about a quotation that comes from pricing, not from context. */
export type PricedQuotation = ReturnType<typeof priceQuotation>;

export function priceQuotation(
  property: QuotedProperty,
  client: QuotedClient | null,
  config: PricingConfig & { currency: string },
  options: { outOfHours?: boolean } = {},
) {
  const priced = computeQuotation(property as QuoteJob, config, options);

  /*
    The exact property and client used, frozen onto the document (FR-2.03,
    §10). A quotation must still render the same a year later, after the
    unit has been re-measured and the client has changed their number.
  */
  const propertySnapshot = {
    unit_label: property.unit_label ?? null,
    building_name: property.building_name ?? null,
    community: property.community ?? null,
    developer_name: property.developer_name ?? null,
    property_type: property.property_type ?? null,
    furnished: property.furnished ?? false,
    bedrooms: property.bedrooms ?? null,
    built_up_area_sqft: property.built_up_area_sqft ?? null,
    client_name: client?.name ?? null,
    client_email: client?.email ?? null,
    client_phone: client?.phone ?? null,
    client_ref: client?.id ?? null,
  };

  /*
    The card as it stood when this was priced. Snapshotted whole rather
    than as the few figures that happened to apply, so the document
    reprices identically after Operations moves a band tomorrow.
  */
  const pricingSnapshot = {
    rate_card: config.rate_card,
    out_of_hours_percent: config.out_of_hours_percent,
    tax_rate: config.tax_rate,
    currency: config.currency,
  };

  return {
    currency: priced.currency,
    subtotal: priced.subtotal,
    tax_rate: priced.tax_rate,
    tax_amount: priced.tax_amount,
    total: priced.total,
    lines: priced.lines,
    scope_of_work: config.scope_of_work,
    terms: config.terms,
    property_snapshot: propertySnapshot,
    pricing_snapshot: pricingSnapshot,
  };
}

/**
 * Prices a de-snagging visit (BA v2, change 31 / §9.3).
 *
 * Nothing like an inspection. An inspection is measured — so many square
 * feet at a rate picked from a band by size — whereas a de-snag is a fixed
 * price per round, because the work is "come back and check the fixes"
 * regardless of how big the unit is. The card publishes it per property
 * type, as a range for apartments and a single figure elsewhere.
 *
 * Returns null where the card says "to be confirmed", which it does for
 * commercial. That is not an error and must not be priced as zero: the
 * caller refuses to raise the quotation and says why, rather than issuing
 * a document offering to do the work for nothing.
 */
export function priceDesnag(
  property: QuotedProperty,
  client: QuotedClient | null,
  config: PricingConfig & { currency: string },
  context: { jobCode?: string | null; round?: number | null } = {},
) {
  const card = config.rate_card;
  const type = property.property_type ?? "apartment";
  const price = card ? desnagPrice(card, type) : null;
  if (price == null) return null;

  const label = TYPE_LABEL[type] ?? type;
  const where = context.jobCode ? ` for ${context.jobCode}` : "";
  const line = {
    description:
      `De-snagging visit${where}: re-inspection of open defects` +
      `${context.round ? `, round ${context.round}` : ""} (${label})`,
    qty: 1,
    unit: "visit",
    unit_price: price,
    amount: price,
  };

  const summary = summarise([line], config);
  const base = priceQuotation(property, client, config);

  return {
    ...base,
    currency: summary.currency,
    subtotal: summary.subtotal,
    tax_rate: summary.tax_rate,
    tax_amount: summary.tax_amount,
    total: summary.total,
    lines: summary.lines,
  };
}

const TYPE_LABEL: Record<string, string> = {
  apartment: "Apartment",
  villa: "Villa",
  townhouse: "Townhouse",
  commercial: "Commercial",
};

/** The admin-owned rate card, or a 400 the caller can return. */
export async function loadPricingConfig(
  admin: Admin,
): Promise<(PricingConfig & { currency: string }) | null> {
  const { data, error } = await admin
    .from("snagging_pricing_config")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as (PricingConfig & { currency: string }) | null) ?? null;
}

/**
 * The fields that put a quotation back to an undecided draft.
 *
 * Regenerating has to clear the decision AND the approval token: leaving
 * the hash behind would keep a link the client was sent working against a
 * document whose figures have since changed.
 */
export const UNDECIDED = {
  status: "draft" as const,
  sent_at: null,
  sent_to: null,
  approved_at: null,
  decided_at: null,
  approved_by_name: null,
  approved_by_contact: null,
  rejected_reason: null,
  approval_token_hash: null,
  approval_token_expires_at: null,
  email_message_id: null,
};
