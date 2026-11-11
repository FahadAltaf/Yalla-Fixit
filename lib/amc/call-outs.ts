import { z } from "zod";

import { AMC_VAT_RATE_BP, filsToAed, toFils } from "@/lib/amc/pricing";
import { TRADES } from "@/lib/amc/client-profile";
import type { Trade } from "@/lib/amc/visits";

/**
 * AMC call outs, additional works and allowances (BRD v0.3 5.13, 5.14;
 * Phase 11: DEV-355, 405-409). Pure rules: the coverage answer, the SLA
 * clock, the allowance balance, the status flows and the quotation totals.
 */

/* ------------------------------------------------------------------ */
/* Call outs                                                           */
/* ------------------------------------------------------------------ */

export const CALL_OUT_PRIORITIES = ["emergency", "non_emergency"] as const;
export type CallOutPriority = (typeof CALL_OUT_PRIORITIES)[number];
export const CALL_OUT_PRIORITY_LABELS: Record<CallOutPriority, string> = { emergency: "Emergency", non_emergency: "Non emergency" };

export const CALL_OUT_CHANNELS = ["call", "whatsapp", "email", "portal"] as const;
export type CallOutChannel = (typeof CALL_OUT_CHANNELS)[number];
export const CALL_OUT_CHANNEL_LABELS: Record<CallOutChannel, string> = { call: "Call", whatsapp: "WhatsApp", email: "Email", portal: "Portal" };

export const CALL_OUT_STATUSES = ["logged", "scheduled", "attended", "resolved", "pending_works", "quoted", "closed", "cancelled"] as const;
export type CallOutStatus = (typeof CALL_OUT_STATUSES)[number];
export const CALL_OUT_STATUS_LABELS: Record<CallOutStatus, string> = {
  logged: "Logged",
  scheduled: "Scheduled",
  attended: "Attended",
  resolved: "Resolved",
  pending_works: "Pending works",
  quoted: "Quoted",
  closed: "Closed",
  cancelled: "Cancelled",
};
export const OPEN_CALL_OUT_STATUSES: readonly CallOutStatus[] = ["logged", "scheduled", "attended", "resolved", "pending_works", "quoted"];

/** The moves each status allows (BRD 5.13: Logged, Scheduled, Attended, Resolved, Pending Works, Quoted, Closed). */
const CALL_OUT_MOVES: Record<CallOutStatus, readonly CallOutStatus[]> = {
  /* An emergency crew can be sent at once: attended straight from logged. */
  logged: ["scheduled", "attended", "cancelled"],
  scheduled: ["scheduled", "attended", "cancelled"],
  attended: ["resolved", "pending_works"],
  pending_works: ["quoted", "resolved", "closed"],
  quoted: ["resolved", "closed"],
  resolved: ["closed"],
  closed: [],
  cancelled: [],
};

export function canMoveCallOut(from: CallOutStatus, to: CallOutStatus): boolean {
  return CALL_OUT_MOVES[from].includes(to);
}

export interface SlaRules {
  emergencyLogMinutes: number;
  emergencyAttendMinutes: number;
  nonEmergencyScheduleHours: number;
  minorFixHours: number;
  atRiskPercent: number;
}

/**
 * The deadlines from the contract clauses 3.1 and 3.2 (BRD 5.13): an
 * emergency is attended within 120 minutes at any hour; a non emergency is
 * attended within 48 hours (the visit takes place within the window).
 */
export function slaDeadlines(priority: CallOutPriority, reportedAt: string, sla: Pick<SlaRules, "emergencyAttendMinutes" | "nonEmergencyScheduleHours">) {
  const at = Date.parse(reportedAt);
  if (priority === "emergency") return { attendDueAt: new Date(at + sla.emergencyAttendMinutes * 60_000).toISOString(), scheduleDueAt: null };
  return { attendDueAt: null, scheduleDueAt: new Date(at + sla.nonEmergencyScheduleHours * 3_600_000).toISOString() };
}

/** The deadline that counts for the call out. */
export const slaDueAt = (c: { attendDueAt: string | null; scheduleDueAt: string | null }) => c.attendDueAt ?? c.scheduleDueAt;

export type SlaState = "met" | "missed" | "at_risk" | "on_track";

/**
 * Met or missed once attended; otherwise at risk once the given share of
 * the window has gone, missed after the deadline. A cancelled call out has
 * no SLA.
 */
export function slaState(
  c: { reportedAt: string; attendedAt: string | null; attendDueAt: string | null; scheduleDueAt: string | null; status: CallOutStatus },
  now: Date,
  atRiskPercent: number,
): SlaState | null {
  const due = slaDueAt(c);
  if (!due || c.status === "cancelled") return null;
  if (c.attendedAt) return Date.parse(c.attendedAt) <= Date.parse(due) ? "met" : "missed";
  const start = Date.parse(c.reportedAt);
  const end = Date.parse(due);
  if (now.getTime() > end) return "missed";
  return now.getTime() - start >= ((end - start) * atRiskPercent) / 100 ? "at_risk" : "on_track";
}

/** "Logged within 60 minutes of the call" (emergency only). */
export function loggedInTime(priority: CallOutPriority, reportedAt: string, loggedAt: string, logMinutes: number): boolean | null {
  if (priority !== "emergency") return null;
  return Date.parse(loggedAt) - Date.parse(reportedAt) <= logMinutes * 60_000;
}

/** Parts, or more than the minor-fix hours, make the corrective work additional work (BRD 5.13). */
export function needsAdditionalWork(input: { priority: CallOutPriority; minutesOnSite: number | null; partsNeeded: boolean }, minorFixHours: number): boolean {
  if (input.partsNeeded) return true;
  return input.priority === "non_emergency" && (input.minutesOnSite ?? 0) > minorFixHours * 60;
}

/* ------------------------------------------------------------------ */
/* Allowances and the coverage answer (DEV-408, 409)                   */
/* ------------------------------------------------------------------ */

export interface AllowanceFacts {
  entitlementType: "visits" | "hours" | "unlimited" | "informational";
  includedQuantity: number | null;
  usedQuantity: number;
  reservedQuantity: number;
}

export interface AllowanceBalance {
  unlimited: boolean;
  included: number | null;
  used: number;
  reserved: number;
  /** null when unlimited (or informational). */
  remaining: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function allowanceBalance(e: AllowanceFacts): AllowanceBalance {
  const counted = e.entitlementType === "visits" || e.entitlementType === "hours";
  return {
    unlimited: e.entitlementType === "unlimited",
    included: counted ? (e.includedQuantity ?? 0) : null,
    used: round2(e.usedQuantity),
    reserved: round2(e.reservedQuantity),
    remaining: counted ? round2(Math.max(0, (e.includedQuantity ?? 0) - e.usedQuantity - e.reservedQuantity)) : null,
  };
}

/** BRD 5.14: warn near zero (configuration: warn when this many remain). */
export function nearZero(b: AllowanceBalance, warningRemaining: number): boolean {
  return b.remaining !== null && b.remaining <= warningRemaining;
}

export interface CoverageInput {
  /** The contract is active and in force on the day. */
  contractInForce: boolean;
  /** The contract's service for this kind of call out, if any. */
  entitlement:
    | (AllowanceFacts & {
        serviceLabel: string;
        labourCovered: boolean;
        materialCoverage: "none" | "consumables" | "parts_within_limit" | "all";
        valueLimitAed: number | null;
        exclusions: string | null;
      })
    | null;
  /** Units the booking would use (1 visit, or hours). */
  quantity: number;
  /** Parts beyond consumables are expected, and their estimated value. */
  partsExpected: boolean;
  partsValueAed: number | null;
  /** The coordinator judged the issue to fall under the contract's exclusions. */
  excluded: boolean;
}

export interface CoverageAnswer {
  coverage: "covered" | "chargeable";
  /** Why, in plain words; the first is the headline. */
  reasons: string[];
  balance: AllowanceBalance | null;
  /** The booking holds a unit of the allowance until the work is done. */
  reserves: boolean;
  /** Parts or materials the client pays for even when the visit is covered. */
  chargeableExtras: string[];
}

/**
 * One entitlement check (DEV-408): quantity, labour, material, value limit
 * and exclusions give covered or chargeable, the balance, and why. The
 * coordinator tells the client before the visit.
 */
export function checkCallOutCoverage(input: CoverageInput): CoverageAnswer {
  const e = input.entitlement;
  if (!input.contractInForce) return { coverage: "chargeable", reasons: ["No AMC is in force today."], balance: null, reserves: false, chargeableExtras: [] };
  if (!e || e.entitlementType === "informational") {
    return { coverage: "chargeable", reasons: ["The AMC does not include call outs of this kind."], balance: null, reserves: false, chargeableExtras: [] };
  }
  const balance = allowanceBalance(e);
  const reasons: string[] = [];
  let chargeable = false;
  if (input.excluded) {
    chargeable = true;
    reasons.push(`Excluded by the contract${e.exclusions ? `: ${e.exclusions}` : ""}.`);
  }
  if (!e.labourCovered) {
    chargeable = true;
    reasons.push("Labour is not covered by the contract.");
  }
  if (balance.remaining !== null && balance.remaining < input.quantity) {
    chargeable = true;
    reasons.push(`${e.serviceLabel}: the allowance is used up (${balance.used} used, ${balance.reserved} booked, ${balance.included} included).`);
  }
  const extras: string[] = [];
  if (input.partsExpected) {
    if (e.materialCoverage === "none" || e.materialCoverage === "consumables") extras.push("Parts are chargeable (the contract covers consumables only).");
    else if (e.materialCoverage === "parts_within_limit") {
      const limit = e.valueLimitAed ?? 0;
      if (input.partsValueAed === null) extras.push(`Parts are covered up to AED ${limit}; anything above is chargeable.`);
      else if (input.partsValueAed > limit) extras.push(`Parts above AED ${limit} are chargeable (estimate AED ${input.partsValueAed}).`);
    }
  }
  if (!chargeable) {
    reasons.unshift(
      balance.unlimited
        ? `Covered: ${e.serviceLabel} is unlimited on this contract.`
        : `Covered: ${e.serviceLabel}, ${balance.remaining} of ${balance.included} left before this booking.`,
    );
  } else reasons.unshift("Chargeable.");
  return {
    coverage: chargeable ? "chargeable" : "covered",
    reasons,
    balance,
    reserves: !chargeable && balance.remaining !== null,
    chargeableExtras: extras,
  };
}

/* ------------------------------------------------------------------ */
/* Additional works (DEV-407)                                          */
/* ------------------------------------------------------------------ */

export const ADDITIONAL_WORK_STATUSES = ["identified", "quotation_prepared", "shared", "approved", "rejected", "scheduled", "completed", "invoiced", "paid"] as const;
export type AdditionalWorkStatus = (typeof ADDITIONAL_WORK_STATUSES)[number];
export const ADDITIONAL_WORK_STATUS_LABELS: Record<AdditionalWorkStatus, string> = {
  identified: "Identified",
  quotation_prepared: "Quotation prepared",
  shared: "Shared",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  completed: "Completed",
  invoiced: "Invoiced",
  paid: "Paid",
};
/** Done or declined: the call out it came from may close. */
export const SETTLED_ADDITIONAL_WORK: readonly AdditionalWorkStatus[] = ["rejected", "completed", "invoiced", "paid"];

const WORK_MOVES: Record<AdditionalWorkStatus, readonly AdditionalWorkStatus[]> = {
  identified: ["quotation_prepared", "rejected"],
  quotation_prepared: ["quotation_prepared", "shared", "rejected"],
  shared: ["quotation_prepared", "approved", "rejected"],
  approved: ["scheduled", "completed"],
  rejected: [],
  scheduled: ["scheduled", "completed"],
  completed: ["invoiced"],
  invoiced: ["paid"],
  paid: [],
};

export function canMoveWork(from: AdditionalWorkStatus, to: AdditionalWorkStatus): boolean {
  return WORK_MOVES[from].includes(to);
}

export const WORK_RISKS = ["low", "medium", "high", "safety"] as const;
export type WorkRisk = (typeof WORK_RISKS)[number];
export const WORK_RISK_LABELS: Record<WorkRisk, string> = { low: "Low", medium: "Medium", high: "High", safety: "Safety" };

export const PARTY_ROLES = ["owner", "tenant", "property_manager", "other"] as const;
export const PARTY_ROLE_LABELS: Record<(typeof PARTY_ROLES)[number], string> = {
  owner: "Owner",
  tenant: "Tenant",
  property_manager: "Property manager",
  other: "Other",
};
export const WORK_PARTIES = ["requester", "approver", "payer", "invoiceRecipient", "reportRecipient"] as const;
export type WorkParty = (typeof WORK_PARTIES)[number];
export const WORK_PARTY_LABELS: Record<WorkParty, string> = {
  requester: "Requester",
  approver: "Approver",
  payer: "Payer",
  invoiceRecipient: "Invoice recipient",
  reportRecipient: "Report recipient",
};

export interface QuotationLine {
  description: string;
  kind: "labour" | "material";
  quantity: number;
  unitPrice: number;
}

/**
 * The quotation's totals: materials carry the handling fee from the
 * contract (20 percent by default), VAT on top. Integer fils throughout.
 */
export function quotationTotals(lines: QuotationLine[], materialFeePercent: number) {
  const lineFils = (l: QuotationLine) => Math.round(l.quantity * toFils(l.unitPrice));
  const labour = lines.filter((l) => l.kind === "labour").reduce((s, l) => s + lineFils(l), 0);
  const material = lines.filter((l) => l.kind === "material").reduce((s, l) => s + lineFils(l), 0);
  const fee = Math.floor((material * Math.round(materialFeePercent * 100) + 5_000) / 10_000);
  const subtotal = labour + material + fee;
  const vat = Math.floor((subtotal * AMC_VAT_RATE_BP + 5_000) / 10_000);
  return {
    labourTotal: filsToAed(labour),
    materialTotal: filsToAed(material),
    materialFee: filsToAed(fee),
    subtotal: filsToAed(subtotal),
    vatAmount: filsToAed(vat),
    total: filsToAed(subtotal + vat),
  };
}

/* ------------------------------------------------------------------ */
/* What the routes accept                                              */
/* ------------------------------------------------------------------ */

const iso = z.string().datetime({ offset: true, message: "Use a date and time" });
const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional().nullable().transform((v) => (v && v.length ? v : null));
const reason = text(500).min(3, "Say why");
const trade = z.enum(TRADES as unknown as [Trade, ...Trade[]]);

export const callOutCreateSchema = z
  .object({
    contractId: uuid,
    priority: z.enum(CALL_OUT_PRIORITIES),
    channel: z.enum(CALL_OUT_CHANNELS),
    reportedAt: iso,
    issue: text(2000).min(3, "Describe the issue"),
    trade: trade.optional().nullable(),
    onSiteContactName: optionalText(120),
    onSiteContactPhone: optionalText(40),
    partsExpected: z.boolean().default(false),
    partsValueAed: z.number().min(0).max(1_000_000).optional().nullable(),
    excluded: z.boolean().default(false),
    /* Book a chargeable call out as covered: needs AMC Allowances (Approve) and a reason. */
    overrideReason: optionalText(500),
  })
  .strict();
export type CallOutCreateInput = z.infer<typeof callOutCreateSchema>;

export const callOutCoverageQuerySchema = callOutCreateSchema.pick({ contractId: true, priority: true, partsExpected: true, partsValueAed: true, excluded: true });

const pendingWork = z.object({ description: text(1000).min(3), reason: text(500).min(1) }).strict();

export const callOutActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("schedule"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      durationMinutes: z.number().int().min(15).max(720),
      technicianIds: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
      overrideReason: optionalText(500),
    })
    .strict(),
  z.object({ action: z.literal("attend"), attendedAt: iso, technicianIds: z.array(z.string().trim().min(1).max(40)).max(10).optional() }).strict(),
  z
    .object({
      action: z.literal("record"),
      diagnosis: optionalText(4000),
      resolution: optionalText(4000),
      partsNeeded: optionalText(1000),
      minutesOnSite: z.number().int().min(0).max(24 * 60).optional().nullable(),
      pendingWorks: z.array(pendingWork).max(30).default([]),
      outcome: z.enum(["resolved", "pending_works"]),
    })
    .strict(),
  z.object({ action: z.literal("close"), note: optionalText(1000) }).strict(),
  z.object({ action: z.literal("cancel"), reason }).strict(),
  z.object({ action: z.literal("flag_misuse"), note: text(1000).min(3, "Say why the emergency line was misused") }).strict(),
  z.object({ action: z.literal("acknowledged") }).strict(),
]);
export type CallOutAction = z.infer<typeof callOutActionSchema>;

const party = z
  .object({
    name: text(160).min(1),
    role: z.enum(PARTY_ROLES).default("other"),
    email: z.string().trim().email().max(200).optional().nullable().or(z.literal("").transform(() => null)),
    phone: optionalText(40),
  })
  .strict();
export type WorkPartyValue = z.infer<typeof party>;

const parties = z
  .object({
    requester: party.nullable().optional(),
    approver: party.nullable().optional(),
    payer: party.nullable().optional(),
    invoiceRecipient: party.nullable().optional(),
    reportRecipient: party.nullable().optional(),
  })
  .strict();

const quotationLine = z
  .object({
    description: text(300).min(1),
    kind: z.enum(["labour", "material"]),
    quantity: z.number().positive().max(10_000),
    unitPrice: z.number().min(0).max(1_000_000),
  })
  .strict();

export const additionalWorkCreateSchema = z
  .object({
    contractId: uuid,
    source: z.enum(["visit", "call_out", "manual"]),
    visitId: uuid.optional().nullable(),
    callOutId: uuid.optional().nullable(),
    technicianId: optionalText(40),
    trade: trade.optional().nullable(),
    finding: text(4000).min(3, "Describe the finding"),
    risk: z.enum(WORK_RISKS).default("low"),
    parties: parties.default({}),
  })
  .strict()
  .refine((v) => (v.source === "visit" ? Boolean(v.visitId) : v.source === "call_out" ? Boolean(v.callOutId) : true), {
    message: "Say which visit or call out it was found on",
  });
export type AdditionalWorkCreateInput = z.infer<typeof additionalWorkCreateSchema>;

export const additionalWorkActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("update"),
      finding: text(4000).min(3).optional(),
      risk: z.enum(WORK_RISKS).optional(),
      trade: trade.optional().nullable(),
      technicianId: optionalText(40),
      parties: parties.optional(),
    })
    .strict(),
  z.object({ action: z.literal("quote"), lines: z.array(quotationLine).min(1).max(60) }).strict(),
  z.object({ action: z.literal("share") }).strict(),
  z.object({ action: z.literal("approve"), evidence: text(1000).min(3, "Say how the client approved (email, signed quotation, WhatsApp)") , approvedBy: optionalText(160) }).strict(),
  z.object({ action: z.literal("reject"), reason }).strict(),
  z.object({ action: z.literal("schedule"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ action: z.literal("complete"), completedAt: iso.optional() }).strict(),
  z.object({ action: z.literal("invoice"), invoiceNumber: text(60).min(1), invoicedAt: iso.optional() }).strict(),
  z.object({ action: z.literal("pay"), paidAt: iso.optional(), reference: optionalText(120) }).strict(),
]);
export type AdditionalWorkAction = z.infer<typeof additionalWorkActionSchema>;
