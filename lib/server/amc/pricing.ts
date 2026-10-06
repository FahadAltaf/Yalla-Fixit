import {
  computeAmcPricing,
  type AmcServiceRowInput,
} from "@/lib/amc/pricing";
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
}

export type PricedSubmission =
  | {
      ok: true;
      services: StoredServiceRow[];
      discount_percent: number;
      discount_amount: number;
      final_price: number;
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
}: {
  services: ReadonlyArray<AmcServiceRowInput>;
  discountPercent: number;
  unitType: string;
  settings: Pick<AmcSettings, "services">;
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

  const pricing = computeAmcPricing(services, discountPercent);
  return {
    ok: true,
    services: pricing.rows.map((row) => ({
      serviceId: row.serviceId,
      included: row.included,
      units: row.units,
      frequency: row.frequency,
      basePrice: row.basePrice,
      free: row.free,
      price: row.price,
    })),
    discount_percent: pricing.discountPercent,
    discount_amount: pricing.discountAmount,
    final_price: pricing.finalPrice,
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
