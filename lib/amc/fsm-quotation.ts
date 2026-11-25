import { z } from "zod";

/**
 * Closing a chargeable call out or completing additional work without its
 * FSM quotation number (25 Nov 2026, the user): the work is done and the
 * report goes out, so closing need not wait for the quotation.
 *
 *   not_chargeable  the client is not charged after all (goodwill, a mistake
 *                   in the booking, a manager's decision): no quotation is
 *                   needed, and Finance sees why.
 *   later           the client is charged, but the quotation is not ready:
 *                   the number stays outstanding and is added on the job
 *                   when it is.
 *
 * Either one needs a reason, kept with the job and in its history.
 */
export const FSM_QUOTATION_SKIPS = ["not_chargeable", "later"] as const;
export type FsmQuotationSkipKind = (typeof FSM_QUOTATION_SKIPS)[number];

export const FSM_QUOTATION_SKIP_LABELS: Record<FsmQuotationSkipKind, string> = {
  not_chargeable: "Not chargeable",
  later: "Quotation number to follow",
};

export const fsmQuotationSkipSchema = z
  .object({
    kind: z.enum(FSM_QUOTATION_SKIPS),
    reason: z.string().trim().min(3, "Say why").max(500, "Keep the reason to 500 characters"),
  })
  .strict();
export type FsmQuotationSkip = z.infer<typeof fsmQuotationSkipSchema>;

/**
 * The hours of a handyman job the client pays for (DEV-495): those beyond
 * the free hours left, or all of them on a chargeable booking. None when
 * the free hours are not counted (unlimited).
 */
export function chargeableHandymanHours(hoursUsed: number, hoursLeft: number | null, covered: boolean): number {
  if (!covered) return hoursUsed;
  if (hoursLeft === null) return 0;
  return Math.max(0, hoursUsed - Math.max(0, hoursLeft));
}
