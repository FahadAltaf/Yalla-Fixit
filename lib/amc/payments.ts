import { z } from "zod";

import type { CustomPlan, PaymentPlan } from "./proposal-rules";

/**
 * AMC payments (BRD v0.3 5.8; Phase 7: DEV-352, 382, 383, 384, 386).
 * Pure rules: the schedule a plan makes, what an instalment's status is
 * from what has come in, ageing, and the shapes the routes accept. No
 * imports beyond the AMC rules, so routes, screens and tests share them.
 *
 * Money is worked in fils (integers) and only turned back into dirhams at
 * the edge, so a schedule always adds up to the contract to the fils.
 */

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export const INSTALMENT_STATUSES = [
  "not_due",
  "due",
  "partially_received",
  "received",
  "overdue",
  "cheque_deposited",
  "bounced",
  "written_off",
  "waived",
] as const;
export type InstalmentStatus = (typeof INSTALMENT_STATUSES)[number];

export const INSTALMENT_STATUS_LABELS: Record<InstalmentStatus, string> = {
  not_due: "Not due",
  due: "Due",
  partially_received: "Partially received",
  received: "Received",
  overdue: "Overdue",
  cheque_deposited: "Cheque deposited",
  bounced: "Bounced",
  written_off: "Written off",
  waived: "Waived",
};

/** Statuses a person sets; the rest follow from what was received and the date. */
export const MANUAL_INSTALMENT_STATUSES = ["written_off", "waived"] as const;
export type ManualInstalmentStatus = (typeof MANUAL_INSTALMENT_STATUSES)[number];

/** Nothing more is expected from an instalment in these. */
export const SETTLED_STATUSES: readonly InstalmentStatus[] = ["received", "written_off", "waived"];

export const PAYMENT_MODES = ["cash", "transfer", "link", "cheque"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  transfer: "Bank transfer",
  link: "Payment link",
  cheque: "Cheque",
};

export const CHEQUE_STATUSES = ["held", "deposited", "cleared", "bounced", "replaced", "returned"] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];
export const CHEQUE_STATUS_LABELS: Record<ChequeStatus, string> = {
  held: "Held",
  deposited: "Deposited",
  cleared: "Cleared",
  bounced: "Bounced",
  replaced: "Replaced",
  returned: "Returned",
};

/** VAT in the UAE (BRD 5.6). Kept as basis points, like lib/amc/pricing.ts. */
const VAT_BP = 500;

const toFils = (aed: number) => Math.round(aed * 100);
const toAed = (fils: number) => fils / 100;

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/** yyyy-MM-dd plus whole months; 31 Jan + 1 month is 28/29 Feb, not 3 Mar. */
export function addMonthsIso(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const out = new Date(Date.UTC(y, m - 1 + months, d));
  if (out.getUTCDate() !== d) out.setUTCDate(0);
  return out.toISOString().slice(0, 10);
}

function addDaysIso(date: string, days: number): string {
  const out = new Date(`${date}T00:00:00Z`);
  out.setUTCDate(out.getUTCDate() + days);
  return out.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both yyyy-MM-dd); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/* The schedule (DEV-382)                                              */
/* ------------------------------------------------------------------ */

export interface ScheduledInstalment {
  instalmentNo: number;
  label: string;
  dueDate: string;
  amount: number;
  vatAmount: number;
  total: number;
}

export interface ScheduleInput {
  plan: PaymentPlan;
  custom?: CustomPlan | null;
  /** What the client pays for the whole contract, VAT included. */
  grandTotal: number;
  /** The VAT inside it, so the instalments' VAT adds up to the contract's. */
  vatAmount?: number | null;
  /** The day the contract is activated: the first instalment falls due then (Email 2: "due on signing"). */
  activationDate: string;
  commencementDate: string;
  termMonths: number;
}

/** How many instalments, and their shares (in basis points of 10,000), for a plan over a term. */
function planShares(plan: PaymentPlan, custom: CustomPlan | null | undefined, termMonths: number): { labels: string[]; offsets: number[]; weights: number[] } {
  const term = Math.max(1, termMonths);
  if (plan === "custom" && custom?.length) {
    const n = custom.length;
    return {
      labels: custom.map((r) => r.label),
      offsets: custom.map((_, i) => Math.round((i * term) / n)),
      weights: custom.map((r) => r.percent),
    };
  }
  const n =
    plan === "fifty_fifty" ? 2 : plan === "quarterly" ? Math.max(1, Math.round(term / 3)) : plan === "monthly" ? term : 1;
  const step = plan === "fifty_fifty" ? Math.floor(term / 2) || 1 : plan === "quarterly" ? 3 : 1;
  const name = plan === "fifty_fifty" ? "Half" : plan === "quarterly" ? "Quarter" : plan === "monthly" ? "Month" : "Payment";
  return {
    labels: Array.from({ length: n }, (_, i) => (n === 1 ? "Full payment" : `${name} ${i + 1} of ${n}`)),
    offsets: Array.from({ length: n }, (_, i) => i * step),
    weights: Array.from({ length: n }, () => 1),
  };
}

/** Splits fils by weights; the last share takes the rounding, so the parts add up exactly. */
function split(totalFils: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const parts = weights.map((w) => Math.floor((totalFils * w) / sum));
  parts[parts.length - 1] += totalFils - parts.reduce((s, p) => s + p, 0);
  return parts;
}

/**
 * The payment schedule a plan makes (BRD 5.8: "on activation the payment
 * schedule is created"). The first instalment is due on activation; the
 * rest fall on the plan's months from commencement. Totals and VAT add up
 * to the contract's, to the fils.
 */
export function buildSchedule(input: ScheduleInput): ScheduledInstalment[] {
  const { labels, offsets, weights } = planShares(input.plan, input.custom, input.termMonths);
  const totalFils = toFils(input.grandTotal);
  const vatFils =
    input.vatAmount !== null && input.vatAmount !== undefined
      ? toFils(input.vatAmount)
      : Math.round((totalFils * VAT_BP) / (10_000 + VAT_BP));
  const totals = split(totalFils, weights);
  const vats = split(vatFils, weights);
  return totals.map((t, i) => ({
    instalmentNo: i + 1,
    label: labels[i],
    dueDate: i === 0 ? minDate(input.activationDate, input.commencementDate) : addMonthsIso(input.commencementDate, offsets[i]),
    amount: toAed(t - vats[i]),
    vatAmount: toAed(vats[i]),
    total: toAed(t),
  }));
}

const minDate = (a: string, b: string) => (a <= b ? a : b);

/* ------------------------------------------------------------------ */
/* Status (DEV-352)                                                    */
/* ------------------------------------------------------------------ */

export interface StatusFacts {
  total: number;
  receivedAmount: number;
  dueDate: string;
  /** The live cheque for the instalment, if any: a deposited one is waiting to clear. */
  cheque: "none" | "held" | "deposited" | "bounced";
  /** Written off or waived by a person: that stands. */
  manual: ManualInstalmentStatus | null;
}

/**
 * An instalment's status from what has come in and the date. Overdue wins
 * over partially received: money short after the due date is what Finance
 * acts on. A deposited cheque holds it at "cheque deposited" until it
 * clears or bounces.
 */
export function instalmentStatus(facts: StatusFacts, today: string, dueSoonDays: number): InstalmentStatus {
  if (facts.manual) return facts.manual;
  if (toFils(facts.receivedAmount) >= toFils(facts.total)) return "received";
  if (facts.cheque === "deposited") return "cheque_deposited";
  if (facts.cheque === "bounced") return "bounced";
  if (today > facts.dueDate) return "overdue";
  if (facts.receivedAmount > 0) return "partially_received";
  return today >= addDaysIso(facts.dueDate, -Math.max(0, dueSoonDays)) ? "due" : "not_due";
}

/** What is still to come in on an instalment (nothing once settled). */
export function outstandingOf(i: { total: number; receivedAmount: number; status: InstalmentStatus }): number {
  if (i.status === "written_off" || i.status === "waived") return 0;
  return toAed(Math.max(0, toFils(i.total) - toFils(i.receivedAmount)));
}

/* ------------------------------------------------------------------ */
/* Balance and ageing (DEV-383)                                        */
/* ------------------------------------------------------------------ */

export const AGEING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];
export const AGEING_LABELS: Record<AgeingBucket, string> = {
  current: "Not yet due",
  d1_30: "1-30 days",
  d31_60: "31-60 days",
  d61_90: "61-90 days",
  d90_plus: "Over 90 days",
};

export function ageingBucket(dueDate: string, today: string): AgeingBucket {
  const late = daysBetween(dueDate, today);
  if (late <= 0) return "current";
  if (late <= 30) return "d1_30";
  if (late <= 60) return "d31_60";
  if (late <= 90) return "d61_90";
  return "d90_plus";
}

export interface BalanceSummary {
  billed: number;
  received: number;
  outstanding: number;
  overdue: number;
  overdueCount: number;
  ageing: Record<AgeingBucket, number>;
}

/** Balance and ageing over a set of instalments (one contract, one client, or all). */
export function summarizeBalance(
  instalments: Array<{ total: number; receivedAmount: number; dueDate: string; status: InstalmentStatus }>,
  today: string,
): BalanceSummary {
  const ageing = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<AgeingBucket, number>;
  let billed = 0;
  let received = 0;
  let outstanding = 0;
  let overdue = 0;
  let overdueCount = 0;
  for (const i of instalments) {
    if (i.status === "written_off" || i.status === "waived") continue;
    billed += toFils(i.total);
    received += toFils(i.receivedAmount);
    const owed = toFils(outstandingOf(i));
    if (owed <= 0) continue;
    outstanding += owed;
    const bucket = ageingBucket(i.dueDate, today);
    ageing[bucket] += owed;
    if (bucket !== "current") {
      overdue += owed;
      overdueCount += 1;
    }
  }
  for (const b of AGEING_BUCKETS) ageing[b] = toAed(ageing[b]);
  return { billed: toAed(billed), received: toAed(received), outstanding: toAed(outstanding), overdue: toAed(overdue), overdueCount, ageing };
}

/* ------------------------------------------------------------------ */
/* The initial payment gate (DEV-386)                                  */
/* ------------------------------------------------------------------ */

/**
 * Whether a contract can start now. It waits in Pending Initial Payment
 * until the first instalment is received, unless an authorised person
 * overrides the gate (agreed credit terms) or there is nothing to pay.
 */
export function gateOpen(first: { total: number; status: InstalmentStatus } | null, override: boolean): boolean {
  if (override) return true;
  if (!first) return true;
  if (toFils(first.total) === 0) return true;
  return first.status === "received" || first.status === "waived" || first.status === "written_off";
}

/* ------------------------------------------------------------------ */
/* What the routes accept                                              */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const money = z
  .number()
  .positive("Enter an amount")
  .max(10_000_000)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, { message: "Use at most two decimals" });
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional().nullable().transform((v) => (v && v.length ? v : null));
const uuid = z.string().uuid();
const reason = z.string().trim().min(3, "Say why").max(500);

const chequeFields = {
  chequeNo: text(40).min(1, "Enter the cheque number"),
  bank: text(120).min(2, "Enter the bank"),
  chequeDate: isoDate,
  custody: optionalText(120),
};

export const paymentActionSchema = z.discriminatedUnion("action", [
  /* Cash, transfer or payment link received now (partial allowed). */
  z
    .object({
      action: z.literal("record_payment"),
      instalmentId: uuid,
      mode: z.enum(["cash", "transfer", "link"]),
      amount: money,
      receivedOn: isoDate,
      reference: optionalText(120),
      valueDate: isoDate.optional().nullable(),
      receiptNo: optionalText(60),
      collectorId: uuid.optional().nullable(),
      proofDocumentId: uuid.optional().nullable(),
      notes: optionalText(500),
    })
    .strict()
    .refine((v) => v.mode !== "transfer" || Boolean(v.reference), { message: "A transfer needs its reference", path: ["reference"] }),
  /* A cheque handed over: held until it is deposited and clears. */
  z
    .object({ action: z.literal("record_cheque"), instalmentId: uuid, amount: money, ...chequeFields, notes: optionalText(500) })
    .strict(),
  z.object({ action: z.literal("cheque_deposit"), chequeId: uuid, depositedOn: isoDate }).strict(),
  z.object({ action: z.literal("cheque_clear"), chequeId: uuid, clearedOn: isoDate }).strict(),
  z
    .object({
      action: z.literal("cheque_bounce"),
      chequeId: uuid,
      bouncedOn: isoDate,
      reason: reason,
      charges: z.number().min(0).max(100_000).optional().nullable(),
    })
    .strict(),
  z
    .object({ action: z.literal("cheque_replace"), chequeId: uuid, amount: money, ...chequeFields })
    .strict(),
  z.object({ action: z.literal("cheque_return"), chequeId: uuid, reason: reason }).strict(),
  z.object({ action: z.literal("void_payment"), paymentId: uuid, reason: reason }).strict(),
  z.object({ action: z.literal("handover"), paymentId: uuid, handedOverTo: text(120).min(2, "Who received it?") }).strict(),
  z.object({ action: z.literal("write_off"), instalmentId: uuid, reason: reason }).strict(),
  z.object({ action: z.literal("waive"), instalmentId: uuid, reason: reason }).strict(),
  z.object({ action: z.literal("override_gate"), reason: reason }).strict(),
  z.object({ action: z.literal("generate_schedule") }).strict(),
  z.object({ action: z.literal("send_reminder"), instalmentId: uuid }).strict(),
]);
export type PaymentAction = z.infer<typeof paymentActionSchema>;

/** Which AMC Payments right each action needs (BRD 6.7: overrides need a named authorised role). */
export function rightFor(action: PaymentAction["action"]): "create" | "edit" | "approve" {
  switch (action) {
    case "write_off":
    case "waive":
    case "override_gate":
      return "approve";
    case "cheque_bounce":
    case "cheque_replace":
    case "cheque_return":
    case "void_payment":
    case "generate_schedule":
      return "edit";
    default:
      return "create";
  }
}

/**
 * Refuses an amount above what is still open on the instalment, counting
 * cheques already held or deposited against it (they will clear into it).
 */
export function checkAmount(amount: number, open: { outstanding: number; pendingCheques: number }): string | null {
  const room = toFils(open.outstanding) - toFils(open.pendingCheques);
  if (room <= 0) return "Nothing is left to collect on this instalment.";
  if (toFils(amount) > room) return `That is more than is left to collect (AED ${toAed(room).toFixed(2)}).`;
  return null;
}
