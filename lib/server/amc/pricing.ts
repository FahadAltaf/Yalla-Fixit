import {
  computeAmcPricing,
  type AmcServiceRowInput,
} from "@/lib/amc/pricing";
import { applyRateCard, type RateCard, type RateFields } from "@/lib/amc/rate-card";
import {
  servicesForProperty,
  type AmcSettings,
} from "@/components/dashboard/extensions/amc/amc-settings";
import { chargeFrequencyType, isFrequencyEditable } from "@/components/dashboard/extensions/amc/amc-constants";
import { isCustomServiceRow } from "@/components/dashboard/extensions/amc/amc-types";

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
  /* Kept as entered (DEV-260/261). */
  equipment?: string;
  customName?: string;
  customScope?: string;
  /* From the rate card, when one priced the row. */
  rateItemId?: string | null;
  standardRate?: number | null;
  floorRate?: number | null;
  promotionId?: string | null;
  promotionPercent?: number | null;
  belowFloor?: boolean;
  /** The rate was changed on this proposal (16 Nov 2026). */
  rateOverride?: boolean;
  /** DEV-501: why it is above the card, and who typed it. */
  rateOverrideReason?: string;
  rateOverrideBy?: string | null;
  /** Visits a year off the card (23 Nov 2026), and the card's numbers, for the approver. */
  frequencyOffCard?: boolean;
  cardFrequencies?: number[];
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
  propertyType = null,
  settings,
  rateCard = null,
  day,
}: {
  services: ReadonlyArray<AmcServiceRowInput>;
  discountPercent: number;
  unitType: string;
  /** The proposal's full property type (a townhouse, a clinic); its own rates come first, then the unit type's. */
  propertyType?: string | null;
  settings: Pick<AmcSettings, "services">;
  /** The card in force (lib/server/amc/rate-card.ts), or null to price as entered. */
  rateCard?: { id: string; card: RateCard } | null;
  /** The pricing day (YYYY-MM-DD, Dubai), for promotions. */
  day?: string;
}): PricedSubmission {
  const offered = new Map(
    servicesForProperty(settings, [propertyType, unitType]).map((service) => [service.id, service]),
  );
  const notOffered = services
    /* A service added to this proposal alone is offered wherever it is added (DEV-260). */
    .filter((row) => row.included && !offered.has(row.serviceId) && !isCustomServiceRow(row))
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
  /*
    A custom service is not on the card, so it keeps the base price entered
    on the proposal; every other row is priced by the card in force.
  */
  const cardable = services.filter((row) => !isCustomServiceRow(row));
  const carded = rateCard
    ? applyRateCard(cardable, rateCard.card, [propertyType, unitType], day ?? new Date().toISOString().slice(0, 10), discountPercent, label, (id) =>
        isFrequencyEditable(offered.get(id)?.frequencyType),
      )
    : null;
  const cardedById = new Map((carded?.rows ?? []).map((row) => [row.serviceId, row]));
  const rows = services.map((row) => cardedById.get(row.serviceId) ?? row);
  /* Weekly and manpower services are charged per week / per month (lib/amc/pricing.ts). */
  const pricing = computeAmcPricing(
    rows.map((row) => ({ ...row, frequencyType: chargeFrequencyType(row.serviceId) })),
    discountPercent,
  );
  return {
    ok: true,
    services: pricing.rows.map((row, i) => {
      const entered = services[i];
      const rate = carded && cardedById.has(row.serviceId) ? (cardedById.get(row.serviceId) as unknown as RateFields) : null;
      return {
        serviceId: row.serviceId,
        included: row.included,
        units: row.units,
        frequency: row.frequency,
        basePrice: row.basePrice,
        free: row.free,
        price: row.price,
        ...(entered?.equipment?.trim() ? { equipment: entered.equipment.trim() } : {}),
        ...(entered?.rateOverride === true && !row.free ? { rateOverride: true } : {}),
        ...(entered?.rateOverride === true && !row.free && entered.rateOverrideReason?.trim()
          ? { rateOverrideReason: entered.rateOverrideReason.trim(), rateOverrideBy: entered.rateOverrideBy ?? null }
          : {}),
        ...(entered?.customName !== undefined ? { customName: entered.customName } : {}),
        ...(entered?.customScope !== undefined ? { customScope: entered.customScope } : {}),
        ...(rate
          ? {
              rateItemId: rate.rateItemId,
              standardRate: rate.standardRate,
              floorRate: rate.floorRate,
              promotionId: rate.promotionId,
              promotionPercent: rate.promotionPercent,
              belowFloor: rate.belowFloor,
              ...(rate.frequencyOffCard ? { frequencyOffCard: true, cardFrequencies: rate.cardFrequencies ?? [] } : {}),
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

/**
 * Who typed each reason for a rate above the card (DEV-501): the saver,
 * unless the reason is the one already saved (then its author stays). The
 * request's own rateOverrideBy is never trusted.
 */
export function stampRateOverrides<R extends { serviceId: string; rateOverrideReason?: string | null; rateOverrideBy?: string | null }>(
  rows: ReadonlyArray<R>,
  previous: ReadonlyArray<{ serviceId: string; rateOverrideReason?: string | null; rateOverrideBy?: string | null }>,
  actorLabel: string | null,
): R[] {
  return rows.map((r) => {
    const reason = r.rateOverrideReason?.trim();
    if (!reason) return { ...r, rateOverrideBy: null };
    const was = previous.find((p) => p.serviceId === r.serviceId);
    return { ...r, rateOverrideBy: was && was.rateOverrideReason?.trim() === reason ? (was.rateOverrideBy ?? actorLabel) : actorLabel };
  });
}
