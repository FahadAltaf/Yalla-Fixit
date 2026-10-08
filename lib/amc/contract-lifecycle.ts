import { z } from "zod";

import type { AmcConfig } from "./config";
import { grandTotalFromFinal } from "./pricing";
import type { CustomPlan, PaymentPlan } from "./proposal-rules";

/**
 * The contract's life (BRD 5.7; DEV-351, 372, 374, 376). Pure: used by the
 * API, the contract page and the tests.
 *
 * A contract exists from the client's approval (draft), is sent for
 * signature, collects the client's and each internal signatory's signature
 * in the configured order (or a signed scan), and is then activated with a
 * commencement date and a term of at least the configured months, which
 * set its expiry. Phase 7 adds the initial payment gate between signing and
 * activation. After that: on hold, expired, renewed, cancelled, terminated,
 * each change kept with its reason.
 */

export const CONTRACT_STATUSES = [
  "draft",
  "pending_client_signature",
  "pending_internal_signature",
  "signed",
  "pending_initial_payment",
  "active",
  "on_hold",
  "expired",
  "renewed",
  "cancelled",
  "terminated",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_NAMES: Record<ContractStatus, string> = {
  draft: "Draft",
  pending_client_signature: "Pending client signature",
  pending_internal_signature: "Pending internal signature",
  signed: "Signed",
  pending_initial_payment: "Pending initial payment",
  active: "Active",
  on_hold: "On hold",
  expired: "Expired",
  renewed: "Renewed",
  cancelled: "Cancelled",
  terminated: "Terminated",
};

/** Before activation: no visits, no coverage. */
export const PRE_ACTIVATION: readonly ContractStatus[] = ["draft", "pending_client_signature", "pending_internal_signature", "signed", "pending_initial_payment"];
/** Still waiting for a signature. */
export const AWAITING_SIGNATURE: readonly ContractStatus[] = ["draft", "pending_client_signature", "pending_internal_signature"];

/* ------------------------------------------------------------------ */
/* Signatories (DEV-374)                                               */
/* ------------------------------------------------------------------ */

export type SigningOrder = "client_first" | "internal_first";

export interface PlannedSignatory {
  party: "client" | "internal";
  sign_order: number;
  name: string;
  email: string | null;
  user_id: string | null;
  title: string | null;
  status: "pending" | "waiting";
}

/** The client and the internal signatories, numbered in the configured order; the first one is up. */
export function planSignatories(
  client: { name: string; email: string | null },
  internal: Array<{ userId: string; name: string; email: string | null; title?: string | null }>,
  order: SigningOrder,
): PlannedSignatory[] {
  const clientRow = { party: "client" as const, name: client.name.trim() || "Client", email: client.email, user_id: null, title: null };
  const internalRows = internal.map((p) => ({ party: "internal" as const, name: p.name, email: p.email, user_id: p.userId, title: p.title ?? null }));
  const ordered = order === "internal_first" ? [...internalRows, clientRow] : [clientRow, ...internalRows];
  return ordered.map((row, i) => ({ ...row, sign_order: i + 1, status: i === 0 ? "pending" : "waiting" }));
}

export interface SignatoryState {
  id: string;
  party: "client" | "internal";
  sign_order: number;
  status: "waiting" | "pending" | "signed" | "cancelled";
}

/** The contract status the signatures put it in: who is up next, or signed when everyone has. */
export function statusFromSignatures(signatories: readonly SignatoryState[]): ContractStatus {
  const open = signatories.filter((s) => s.status !== "signed" && s.status !== "cancelled").sort((a, b) => a.sign_order - b.sign_order);
  if (open.length === 0) return "signed";
  return open[0].party === "client" ? "pending_client_signature" : "pending_internal_signature";
}

/** After one signs: the next in order becomes pending. */
export function nextPendingSignatory(signatories: readonly SignatoryState[]): SignatoryState | null {
  return [...signatories].filter((s) => s.status === "waiting" || s.status === "pending").sort((a, b) => a.sign_order - b.sign_order)[0] ?? null;
}

/** Whether this person may sign now: their row is the one pending. */
export function canSignInternally(signatories: ReadonlyArray<SignatoryState & { user_id?: string | null }>, userId: string): SignatoryState | null {
  const next = nextPendingSignatory(signatories);
  if (!next || next.party !== "internal") return null;
  const row = signatories.find((s) => s.id === next.id) as (SignatoryState & { user_id?: string | null }) | undefined;
  return row?.user_id === userId ? next : null;
}

/* ------------------------------------------------------------------ */
/* Term and activation (DEV-372)                                       */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");

/** The last day of a term of `months` starting on `start` (one day before the same date `months` later). */
export function expiryFromCommencement(start: string, months: number): string {
  const [y, m, d] = start.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1 + months, d));
  /* 31 Jan + 1 month overflows to 3 Mar: step back to the month's last day. */
  if (end.getUTCDate() !== d) end.setUTCDate(0);
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

export const activationSchema = z
  .object({
    action: z.literal("activate"),
    commencementDate: isoDate,
    termMonths: z.number().int().min(1).max(120),
    /* Phase 7 (DEV-386): start before the first instalment arrives, on agreed
       credit terms. Needs AMC Payments (Approve), and always a reason. */
    startWithoutPayment: z
      .object({ reason: z.string().trim().min(3, "Say why the contract starts before the first payment").max(500) })
      .strict()
      .optional()
      .nullable(),
  })
  .strict();

export function checkTerm(termMonths: number, contracts: Pick<AmcConfig["contracts"], "minimumTermMonths">): string | null {
  return termMonths < contracts.minimumTermMonths ? `The term is at least ${contracts.minimumTermMonths} months (AMC configuration).` : null;
}

/** Residential or commercial template, by the property's category. */
export function templateForCategory(category: string | null | undefined): "residential" | "commercial" {
  return category === "commercial" ? "commercial" : "residential";
}

/* ------------------------------------------------------------------ */
/* Status changes after signing (DEV-376)                              */
/* ------------------------------------------------------------------ */

export const MANUAL_STATUS_TARGETS = ["on_hold", "active", "terminated", "cancelled"] as const;
export type ManualStatusTarget = (typeof MANUAL_STATUS_TARGETS)[number];

export const statusChangeSchema = z
  .object({
    action: z.literal("status"),
    to: z.enum(MANUAL_STATUS_TARGETS),
    reason: z.string().trim().min(3, "Give the reason").max(1000),
  })
  .strict();

const ALLOWED: Record<ManualStatusTarget, readonly ContractStatus[]> = {
  on_hold: ["active"],
  /* Resume: only from on hold (activation is its own step). */
  active: ["on_hold"],
  terminated: ["active", "on_hold"],
  /* Before it starts: called off. */
  cancelled: ["draft", "pending_client_signature", "pending_internal_signature", "signed", "pending_initial_payment"],
};

export function checkStatusChange(from: ContractStatus, to: ManualStatusTarget): string | null {
  if (!ALLOWED[to].includes(from)) return `A contract that is ${CONTRACT_STATUS_NAMES[from].toLowerCase()} cannot be ${to === "active" ? "resumed" : CONTRACT_STATUS_NAMES[to].toLowerCase()}.`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Email 2 (BRD 6.1)                                                   */
/* ------------------------------------------------------------------ */

/** The first instalment, as Email 2 quotes it (incl. VAT). */
export function firstInstalment(plan: PaymentPlan, custom: CustomPlan | null, finalPriceExclVat: number): number {
  const total = grandTotalFromFinal(finalPriceExclVat);
  const share =
    plan === "fifty_fifty" ? 0.5 : plan === "quarterly" ? 0.25 : plan === "monthly" ? 1 / 12 : plan === "custom" && custom?.length ? custom[0].percent / 100 : 1;
  return Math.round(total * share * 100) / 100;
}

export const scanSchema = z
  .object({
    action: z.literal("scan"),
    documentId: z.string().uuid("Upload the signed scan first"),
    signedDate: isoDate,
    signedByName: z.string().trim().min(2, "Who signed for the client?").max(200),
  })
  .strict();

export const signSchema = z
  .object({
    action: z.literal("sign"),
    typedName: z.string().trim().min(2, "Type your full name").max(200),
  })
  .strict();

export const entitlementTermsSchema = z
  .object({
    action: z.literal("entitlement"),
    entitlementId: z.string().uuid(),
    labourCovered: z.boolean(),
    materialCoverage: z.enum(["none", "consumables", "parts_within_limit", "all"]),
    valueLimitAed: z.number().min(0).max(10_000_000).nullable(),
    exclusions: z.string().trim().max(1000).nullable(),
  })
  .strict();

export const MATERIAL_LABELS = {
  none: "No materials",
  consumables: "Consumables",
  parts_within_limit: "Parts within the limit",
  all: "All materials",
} as const;

export const lifecycleActionSchema = z.discriminatedUnion("action", [
  activationSchema,
  statusChangeSchema,
  scanSchema,
  signSchema,
  entitlementTermsSchema,
]);
export type LifecycleAction = z.infer<typeof lifecycleActionSchema>;
