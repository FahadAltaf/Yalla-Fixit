import { z } from "zod";

/**
 * Contract amendments (BRD v0.3 5.16; Phase 13: DEV-417). Scope change,
 * property change, hold, resume, transfer to a new owner or tenant, early
 * termination and cancellation are edge cases that need approval, not
 * default options: each is requested with a reason, decided by an AMC
 * approver who is not the requester, then applied.
 */

export const AMENDMENT_KINDS = ["scope_change", "property_change", "hold", "resume", "transfer", "early_termination", "cancellation"] as const;
export type AmendmentKind = (typeof AMENDMENT_KINDS)[number];
export const AMENDMENT_LABELS: Record<AmendmentKind, string> = {
  scope_change: "Scope change",
  property_change: "Property change",
  hold: "Hold",
  resume: "Resume",
  transfer: "Transfer to a new owner or tenant",
  early_termination: "Early termination",
  cancellation: "Cancellation",
};
export const AMENDMENT_HINTS: Record<AmendmentKind, string> = {
  scope_change: "A new contract for the extra services, or this one ended and a full new one written (BRD 5.16). Applying opens the new proposal.",
  property_change: "The contract moves to another address of the same client.",
  hold: "Pauses the contract and its schedule: no visits are offered, confirmed or chased while it is on hold.",
  resume: "Ends the hold. Visits whose window passed during the hold are planned again.",
  transfer: "A new owner or tenant takes the contract over from a date.",
  early_termination: "30 days' notice under the contract; a pro-rata refund only with a valid reason.",
  cancellation: "Calls the contract off before it starts.",
};

export const AMENDMENT_STATUSES = ["requested", "approved", "rejected", "applied", "withdrawn"] as const;
export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];
export const AMENDMENT_STATUS_LABELS: Record<AmendmentStatus, string> = {
  requested: "Waiting for approval",
  approved: "Approved, to apply",
  rejected: "Rejected",
  applied: "Applied",
  withdrawn: "Withdrawn",
};

/** The contract statuses each amendment can be asked for in. */
const ALLOWED_FROM: Record<AmendmentKind, readonly string[]> = {
  scope_change: ["active", "on_hold"],
  property_change: ["active", "on_hold", "signed", "pending_initial_payment"],
  hold: ["active"],
  resume: ["on_hold"],
  transfer: ["active", "on_hold"],
  early_termination: ["active", "on_hold"],
  cancellation: ["draft", "pending_client_signature", "pending_internal_signature", "signed", "pending_initial_payment"],
};

export function amendmentProblem(kind: AmendmentKind, contractStatus: string): string | null {
  if (ALLOWED_FROM[kind].includes(contractStatus)) return null;
  return `${AMENDMENT_LABELS[kind]} cannot be asked for on a contract that is ${contractStatus.replace(/_/g, " ")}.`;
}

/** Nobody approves their own request (BRD 5.5 applied to amendments). */
export function canDecide(requestedBy: string | null, deciderId: string): boolean {
  return Boolean(deciderId) && requestedBy !== deciderId;
}

const dayMs = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

/** Contract clause: termination takes effect 30 days after the notice (or later, if asked). */
export function terminationEffective(noticeOn: string, requestedEffective: string | null, noticeDays = 30): string {
  const earliest = addDays(noticeOn, noticeDays);
  return requestedEffective && requestedEffective > earliest ? requestedEffective : earliest;
}

/**
 * Pro-rata refund (BRD 5.16: "pro rata refund with a valid reason,
 * otherwise none"): what was received beyond the value of the days served
 * up to the effective date. Never negative; nothing without a valid reason.
 */
export function proRataRefund(input: { grandTotal: number; received: number; startDate: string; endDate: string; effectiveOn: string; validReason: boolean }) {
  const total = Math.max(1, days(input.startDate, input.endDate) + 1);
  const served = Math.min(total, Math.max(0, days(input.startDate, input.effectiveOn)));
  const earned = Math.round(((input.grandTotal * served) / total) * 100) / 100;
  const refund = input.validReason ? Math.max(0, Math.round((input.received - earned) * 100) / 100) : 0;
  return { totalDays: total, servedDays: served, earned, refund };
}

/* ------------------------------------------------------------------ */
/* What the routes accept                                              */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const reason = z.string().trim().min(3, "Give the reason").max(1000);
const uuid = z.string().uuid();
const party = z
  .object({
    customerName: z.string().trim().min(1).max(160),
    customerEmail: z.string().trim().email().max(200).optional().nullable(),
    customerPhone: z.string().trim().max(40).optional().nullable(),
    role: z.enum(["owner", "tenant"]),
  })
  .strict();

export const amendmentRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scope_change"), reason, mode: z.enum(["add_services", "replace_contract"]), effectiveOn: isoDate }).strict(),
  z.object({ kind: z.literal("property_change"), reason, propertyId: uuid, effectiveOn: isoDate }).strict(),
  z.object({ kind: z.literal("hold"), reason, effectiveOn: isoDate, until: isoDate.optional().nullable() }).strict(),
  z.object({ kind: z.literal("resume"), reason, effectiveOn: isoDate }).strict(),
  z.object({ kind: z.literal("transfer"), reason, effectiveOn: isoDate, to: party, clientId: uuid.optional().nullable() }).strict(),
  z.object({ kind: z.literal("early_termination"), reason, noticeOn: isoDate, effectiveOn: isoDate.optional().nullable() }).strict(),
  z.object({ kind: z.literal("cancellation"), reason }).strict(),
]);
export type AmendmentRequest = z.infer<typeof amendmentRequestSchema>;

export const amendmentActionSchema = z.discriminatedUnion("action", [
  /* The approver decides whether a termination's reason is valid (it decides the refund). */
  z.object({ action: z.literal("approve"), comment: z.string().trim().max(1000).optional().nullable(), validReason: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("reject"), comment: reason }).strict(),
  z.object({ action: z.literal("apply") }).strict(),
  z.object({ action: z.literal("withdraw") }).strict(),
]);
export type AmendmentAction = z.infer<typeof amendmentActionSchema>;
