/**
 * The MAHER total against the portal's (Sami, 9 and 13 Nov 2026). Finance
 * enters the total printed on the MAHER invoice; the portal's is the lines
 * plus VAT. A difference within AED 1.00 is VAT rounding and needs nothing;
 * beyond it, a reason is required. The database checks the same rule
 * (migration 20261118150000), so keep the two in step.
 */

export const VARIANCE_TOLERANCE_AED = 1;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** MAHER less the portal, with VAT; positive when MAHER billed more. */
export function invoiceVariance(maherTotal: number, portalTotal: number): number {
  return round2(maherTotal - portalTotal);
}

/** True when the difference is more than rounding and so needs a reason. */
export function varianceNeedsReason(maherTotal: number | null | undefined, portalTotal: number): boolean {
  if (maherTotal === null || maherTotal === undefined || !Number.isFinite(maherTotal)) return false;
  return Math.abs(invoiceVariance(maherTotal, portalTotal)) > VARIANCE_TOLERANCE_AED + 0.000001;
}
