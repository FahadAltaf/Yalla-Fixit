import { z } from "zod";

import { amcSelfApprovalOn } from "./workflow";

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
  early_termination: "30 days' notice. A refund for the unused part of the contract, only if the reason is accepted.",
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

/**
 * Nobody approves their own request (BRD 5.5 applied to amendments), except
 * with the local testing switch (24 Nov 2026), as proposals have it:
 * NEXT_PUBLIC_AMC_SELF_APPROVAL=on, never on a production build.
 */
export function canDecide(requestedBy: string | null, deciderId: string, selfApproval = amcSelfApprovalOn()): boolean {
  return Boolean(deciderId) && (requestedBy !== deciderId || selfApproval);
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

/* ------------------------------------------------------------------ */
/* What the approver checks (23 Nov 2026)                              */
/* ------------------------------------------------------------------ */

export interface AmendmentCheck {
  key: string;
  label: string;
  state: "ok" | "missing" | "warn";
  detail: string;
}

/**
 * The approver's checklist on a requested amendment (23 Nov 2026, the user:
 * the same checklist as proposals and site visits): who asked, why, whether
 * the contract allows it now, the dates, and what each kind needs looked at
 * (the notice period and refund of a termination, that a cancellation calls
 * every visit off, a transfer's new party, a hold's end).
 */
export function amendmentChecklist(
  a: { kind: AmendmentKind; reason: string; requestedBy: string | null; requestedByName: string | null; effectiveOn: string | null; details: Record<string, unknown> },
  ctx: { contractStatus: string; viewerId: string; today: string; propertyLabel?: string | null },
): AmendmentCheck[] {
  const d = a.details ?? {};
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const aed = (v: number) => `AED ${v.toLocaleString("en-AE", { maximumFractionDigits: 2 })}`;
  const checks: AmendmentCheck[] = [];
  const own = Boolean(a.requestedBy) && a.requestedBy === ctx.viewerId;
  checks.push(
    own && amcSelfApprovalOn()
      ? { key: "who", label: "Requested by", state: "ok", detail: "You asked for it. As an approver you may decide it yourself." }
      : own
      ? { key: "who", label: "Requested by", state: "warn", detail: "You asked for it, so someone else approves it." }
      : { key: "who", label: "Requested by", state: "ok", detail: `${a.requestedByName ?? "Someone else"}: not the approver, as the rule asks.` },
  );
  const why = a.reason.trim();
  checks.push(
    why.length >= 10
      ? { key: "reason", label: "Reason", state: "ok", detail: why.length > 140 ? `${why.slice(0, 137)}…` : why }
      : { key: "reason", label: "Reason", state: "warn", detail: `Very short ("${why}"). Ask for more if it does not explain the change.` },
  );
  const problem = amendmentProblem(a.kind, ctx.contractStatus);
  checks.push(
    problem
      ? { key: "allowed", label: "Allowed now", state: "missing", detail: problem }
      : { key: "allowed", label: "Allowed now", state: "ok", detail: `The contract is ${ctx.contractStatus.replace(/_/g, " ")}, where a ${AMENDMENT_LABELS[a.kind].toLowerCase()} can be made.` },
  );
  if (a.effectiveOn && a.kind !== "cancellation") {
    checks.push(
      a.effectiveOn < ctx.today
        ? { key: "date", label: "Effective date", state: "warn", detail: `${a.effectiveOn} is in the past. Applying acts on it at once.` }
        : { key: "date", label: "Effective date", state: "ok", detail: a.effectiveOn },
    );
  }
  switch (a.kind) {
    case "early_termination": {
      const notice = s(d.noticeOn);
      const earliest = notice ? terminationEffective(notice, null) : null;
      checks.push(
        notice && a.effectiveOn && earliest && a.effectiveOn >= earliest
          ? { key: "notice", label: "Notice period", state: "ok", detail: `Notice ${notice}; takes effect ${a.effectiveOn}, at least 30 days later as the contract asks.` }
          : { key: "notice", label: "Notice period", state: "warn", detail: "Check the 30 days of notice: the dates do not show it." },
      );
      const refund = n(d.refundIfValid);
      const received = n(d.received);
      checks.push({
        key: "refund",
        label: "Refund",
        state: "warn",
        detail: `You decide whether the reason is accepted. Accepted: a refund for the unused part of the contract, about ${aed(refund ?? 0)}${received !== null ? ` (${aed(received)} received so far)` : ""}. Not accepted: no refund.`,
      });
      break;
    }
    case "cancellation":
      checks.push({ key: "final", label: "Cannot be undone", state: "warn", detail: "Every visit is called off and the contract ends before it starts." });
      break;
    case "transfer": {
      const to = (d.to ?? {}) as Record<string, unknown>;
      const contact = [s(to.customerEmail), s(to.customerPhone)].filter(Boolean);
      checks.push(
        contact.length
          ? { key: "party", label: "New party", state: "ok", detail: `${s(to.customerName) ?? "Named"}${s(to.role) ? ` (${s(to.role)})` : ""}: ${contact.join(", ")}` }
          : { key: "party", label: "New party", state: "missing", detail: `${s(to.customerName) ?? "The new party"} has no email or phone, so they cannot be reached.` },
      );
      break;
    }
    case "hold":
      checks.push(
        s(d.until)
          ? { key: "until", label: "Hold ends", state: "ok", detail: String(d.until) }
          : { key: "until", label: "Hold ends", state: "warn", detail: "No end date: the contract stays on hold until someone resumes it." },
      );
      break;
    case "property_change":
      checks.push({
        key: "property",
        label: "New property",
        state: s(d.propertyLabel) ? "ok" : "missing",
        detail: s(d.propertyLabel) ? `From ${ctx.propertyLabel || "the current property"} to ${s(d.propertyLabel)}` : "No property named.",
      });
      break;
    case "scope_change":
      checks.push({
        key: "scope",
        label: "What applying does",
        state: "ok",
        detail: d.mode === "replace_contract" ? "Ends this contract and opens a full new proposal, which goes through its own approval." : "Opens a new proposal for the extra services, which goes through its own approval.",
      });
      break;
    case "resume":
      break;
  }
  return checks;
}
