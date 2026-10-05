/**
 * AMC pricing: the one implementation.
 *
 * Used by the API (which stores the result and never trusts a total sent
 * by the browser), by the wizard, by every document and by the lists, so
 * a figure cannot differ between the screen, the PDF and the database.
 *
 * Money rule (AED): every amount is held as a whole number of fils
 * (1 AED = 100 fils) and rounded once, half up, at the step that creates
 * it:
 *
 *   row        = basePrice x units x frequency       (exact in fils)
 *   subtotal   = sum of ticked rows
 *   discount   = subtotal x discount%   -> rounded half up to the fil
 *   final      = subtotal - discount                (annual fee, excl. VAT)
 *   VAT        = final x 5%             -> rounded half up to the fil
 *   grandTotal = final + VAT
 *
 * Because each later figure is built from already-rounded fils, the
 * printed parts always add up to the printed total, and the amount in
 * words is read from the same integer as the figure next to it.
 *
 * No imports beyond zod: this file runs on the server and in the browser.
 */
import { z } from "zod";

/** 5% UAE VAT, in basis points (1 bp = 0.01%). */
export const AMC_VAT_RATE_BP = 500;
export const AMC_VAT_PERCENT = AMC_VAT_RATE_BP / 100;

export const MAX_UNITS = 10_000;
export const MAX_FREQUENCY = 1_000;
export const MAX_BASE_PRICE = 10_000_000;

/* ------------------------------------------------------------------ */
/* Money helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * AED to whole fils, half up. The small epsilon absorbs binary noise
 * (1.005 is stored as 1.00499999…, which is still meant as 1.005).
 */
export function toFils(aed: number): number {
  if (!Number.isFinite(aed)) return 0;
  const sign = aed < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(aed) * 100 + 0.5 + 1e-7);
}

export function filsToAed(fils: number): number {
  return fils / 100;
}

/** Rounds an AED amount to two decimals, half up. */
export function roundAed(aed: number): number {
  return filsToAed(toFils(aed));
}

/** `fils x rateBp / 10000`, rounded half up, using integers only. */
function applyBasisPoints(fils: number, rateBp: number): number {
  return Math.floor((fils * rateBp + 5_000) / 10_000);
}

/** A percentage (e.g. 7.5) as basis points (750), half up. */
export function percentToBasisPoints(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.floor(Math.abs(percent) * 100 + 0.5 + 1e-7);
}

/* ------------------------------------------------------------------ */
/* Rows and totals                                                     */
/* ------------------------------------------------------------------ */

export interface AmcPricingRowInput {
  serviceId: string;
  included: boolean;
  units: number;
  frequency: number;
  /** Undefined or null: not priced yet; counts as 0 until it is. */
  basePrice?: number | null;
}

export interface AmcPricedRow {
  serviceId: string;
  included: boolean;
  units: number;
  frequency: number;
  basePrice: number | null;
  /** basePrice x units x frequency; 0 when not ticked. */
  price: number;
  priceFils: number;
}

export interface AmcPricing {
  rows: AmcPricedRow[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  /** Annual fee before VAT. This is what `final_price` stores. */
  finalPrice: number;
  vatAmount: number;
  grandTotal: number;
  /** The annual fee spread over twelve months, rounded half up. */
  monthlyPrice: number;
  fils: {
    subtotal: number;
    discount: number;
    final: number;
    vat: number;
    grandTotal: number;
  };
}

export function rowPriceFils(row: AmcPricingRowInput): number {
  if (!row.included) return 0;
  const baseFils = toFils(row.basePrice ?? 0);
  return baseFils * Math.trunc(row.units) * Math.trunc(row.frequency);
}

export function rowPrice(row: AmcPricingRowInput): number {
  return filsToAed(rowPriceFils(row));
}

export function computeAmcPricing(
  rows: ReadonlyArray<AmcPricingRowInput>,
  discountPercent: number | null | undefined = 0,
): AmcPricing {
  const priced: AmcPricedRow[] = rows.map((row) => {
    const priceFils = rowPriceFils(row);
    return {
      serviceId: row.serviceId,
      included: row.included,
      units: row.units,
      frequency: row.frequency,
      basePrice:
        row.basePrice === undefined || row.basePrice === null
          ? null
          : roundAed(row.basePrice),
      price: filsToAed(priceFils),
      priceFils,
    };
  });

  const subtotalFils = priced.reduce((sum, row) => sum + row.priceFils, 0);
  const pct = Math.min(100, Math.max(0, discountPercent ?? 0));
  const discountFils = applyBasisPoints(subtotalFils, percentToBasisPoints(pct));
  const finalFils = subtotalFils - discountFils;
  const vatFils = applyBasisPoints(finalFils, AMC_VAT_RATE_BP);
  const grandFils = finalFils + vatFils;

  return {
    rows: priced,
    subtotal: filsToAed(subtotalFils),
    discountPercent: pct,
    discountAmount: filsToAed(discountFils),
    finalPrice: filsToAed(finalFils),
    vatAmount: filsToAed(vatFils),
    grandTotal: filsToAed(grandFils),
    monthlyPrice: filsToAed(Math.floor((finalFils + 6) / 12)),
    fils: {
      subtotal: subtotalFils,
      discount: discountFils,
      final: finalFils,
      vat: vatFils,
      grandTotal: grandFils,
    },
  };
}

/** VAT on a stored annual fee (excl. VAT), by the same rule. */
export function vatOnFinal(finalPriceExclVat: number): number {
  return filsToAed(applyBasisPoints(toFils(finalPriceExclVat), AMC_VAT_RATE_BP));
}

/**
 * The VAT-inclusive total for a stored `final_price`. Matches
 * computeAmcPricing(...).grandTotal for the same proposal exactly.
 */
export function grandTotalFromFinal(finalPriceExclVat: number): number {
  const finalFils = toFils(finalPriceExclVat);
  return filsToAed(finalFils + applyBasisPoints(finalFils, AMC_VAT_RATE_BP));
}

/* ------------------------------------------------------------------ */
/* Server-side input validation                                        */
/* ------------------------------------------------------------------ */

/**
 * One service row as the API accepts it. Whatever totals the browser also
 * sends (`price`, `final_price`, `discount_amount`) are ignored: the
 * server derives them from these fields.
 */
export const amcServiceRowInputSchema = z.object({
  serviceId: z.string().trim().min(1).max(100),
  included: z.boolean(),
  units: z.number().int().min(1).max(MAX_UNITS),
  frequency: z.number().int().min(1).max(MAX_FREQUENCY),
  basePrice: z.number().finite().min(0).max(MAX_BASE_PRICE).nullable().optional(),
  /** Accepted for compatibility, never trusted. */
  price: z.number().optional(),
});

export const amcServiceRowsInputSchema = z
  .array(amcServiceRowInputSchema)
  .max(100)
  .refine(
    (rows) => new Set(rows.map((row) => row.serviceId)).size === rows.length,
    { message: "Each service may appear only once" },
  );

export const discountPercentSchema = z.number().finite().min(0).max(100);

export type AmcServiceRowInput = z.infer<typeof amcServiceRowInputSchema>;
