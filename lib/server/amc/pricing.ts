import {
  computeAmcPricing,
  type AmcServiceRowInput,
} from "@/lib/amc/pricing";
import { applyRateCard, type RateCard, type RateFields } from "@/lib/amc/rate-card";
import {
  servicesForProperty,
  type AmcSettings,
} from "@/components/dashboard/extensions/amc/amc-settings";

/**
 * Server-side pricing for a proposal: the figures the database stores.
 *
 * The browser sends the rows it was given (base price, units, frequency,
 * ticked or not). Whatever totals it also sends are ignored; the server
 * works them out with lib/amc/pricing.ts and stores those. That closes the
 * gap where a request could save any final_price it liked, and it means
 * the list, the approval notice, the client email and the documents all
 * read one figure.
 *
 * With a rate card in force (BRD 5.3) the base prices come from the card,
 * whatever the browser sent: the line keeps the rate it was priced at, its
 * floor and any promotion, and a discount that takes a line under its floor
 * is marked. Without a card (none published, or the update not applied)
 * the base prices entered on the proposal are used, as before.
 */

export interface StoredServiceRow {
  serviceId: string;
  included: boolean;
  units: number;
  frequency: number;
  basePrice: number | null;
  /** Included at no charge: kept with the row so it reopens as free. */
  free: boolean;
  price: number;
  /* From the rate card, when one priced the row. */
  rateItemId?: string | null;
  standardRate?: number | null;
  floorRate?: number | null;
  promotionId?: string | null;
  promotionPercent?: number | null;
  belowFloor?: boolean;
}

export type PricedSubmission =
  | {
      ok: true;
      services: StoredServiceRow[];
      discount_percent: number;
      discount_amount: number;
      final_price: number;
      /** Set when a rate card priced the rows. */
      rate_card_version_id: string | null;
      below_floor: boolean;
      /** Ticked rows the card cannot price as they stand; blocks submitting, not saving a draft. */
      rateProblems: string[];
    }
  | { ok: false; error: string };

/**
 * Prices a proposal's rows against the services AMC Settings offers on
 * this kind of property. A ticked service that is not offered is refused:
 * it would be charged while every document left it out.
 */
export function priceSubmission({
  services,
  discountPercent,
  unitType,
  settings,
  rateCard = null,
  day,
}: {
  services: ReadonlyArray<AmcServiceRowInput>;
  discountPercent: number;
  unitType: string;
  settings: Pick<AmcSettings, "services">;
  /** The card in force (lib/server/amc/rate-card.ts), or null to price as entered. */
  rateCard?: { id: string; card: RateCard } | null;
  /** The pricing day (YYYY-MM-DD, Dubai), for promotions. */
  day?: string;
}): PricedSubmission {
  const offered = new Map(
    servicesForProperty(settings, unitType).map((service) => [service.id, service]),
  );
  const notOffered = services
    .filter((row) => row.included && !offered.has(row.serviceId))
    .map((row) => row.serviceId);
  if (notOffered.length > 0) {
    return {
      ok: false,
      error: `Not offered on this kind of property in AMC Settings: ${notOffered.join(", ")}. Untick ${
        notOffered.length === 1 ? "it" : "them"
      } and save again.`,
    };
  }

  const label = (id: string) => offered.get(id)?.label ?? id;
  const carded = rateCard
    ? applyRateCard(services, rateCard.card, unitType, day ?? new Date().toISOString().slice(0, 10), discountPercent, label)
    : null;
  const rows = carded ? carded.rows : services;
  const pricing = computeAmcPricing(rows, discountPercent);
  return {
    ok: true,
    services: pricing.rows.map((row, i) => {
      const rate = carded ? (carded.rows[i] as RateFields) : null;
      return {
        serviceId: row.serviceId,
        included: row.included,
        units: row.units,
        frequency: row.frequency,
        basePrice: row.basePrice,
        free: row.free,
        price: row.price,
        ...(rate
          ? {
              rateItemId: rate.rateItemId,
              standardRate: rate.standardRate,
              floorRate: rate.floorRate,
              promotionId: rate.promotionId,
              promotionPercent: rate.promotionPercent,
              belowFloor: rate.belowFloor,
            }
          : {}),
      };
    }),
    discount_percent: pricing.discountPercent,
    discount_amount: pricing.discountAmount,
    final_price: pricing.finalPrice,
    rate_card_version_id: rateCard?.id ?? null,
    below_floor: carded?.belowFloor ?? false,
    rateProblems: carded?.problems ?? [],
  };
}

/**
 * FR2.12, enforced on the server at submit: something is ticked, and every
 * ticked row has a base price (0 is a price; blank is not).
 */
export function submittableProblem(
  services: ReadonlyArray<Pick<AmcServiceRowInput, "serviceId" | "included" | "basePrice"> & { free?: boolean | null }>,
): string | null {
  const ticked = services.filter((row) => row.included);
  if (ticked.length === 0) return "Tick at least one service before submitting.";
  /* A row included at no charge has no base price to ask for. */
  const unpriced = ticked.filter(
    (row) => !row.free && (row.basePrice === undefined || row.basePrice === null),
  );
  if (unpriced.length > 0) {
    return `Enter a base price for every ticked service before submitting (missing: ${unpriced
      .map((row) => row.serviceId)
      .join(", ")}).`;
  }
  return null;
}
