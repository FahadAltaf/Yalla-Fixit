import { z } from "zod";

import type { AmcConfig } from "./config";
import { discountApprovalLevel, isNonStandardPlan, PAYMENT_PLAN_LABELS, type PaymentPlan } from "./proposal-rules";

/**
 * The approval ladder and sharing (BRD 5.5, 5.6; DEV-369, 370, 371). Pure:
 * used by the API, the proposal screens and the tests.
 *
 * On share the four triggers are checked: the discount, the final value, a
 * payment plan outside the standard rule, and a line priced below its floor.
 * Each crossed trigger names a level (thresholds and levels are AMC
 * configuration); the highest one is how far up the ladder the proposal
 * goes. No trigger: it is shared directly. Levels decide in sequence, from
 * level 1. Approve, reject or return, each logged; nobody decides on their
 * own proposal; an open level escalates after the configured hours.
 *
 * A new version goes back through approval only when it needs more than
 * the version before it was approved for: a higher level, a larger
 * discount, a different plan, or a new below-floor line (BRD 5.5).
 */

export const APPROVAL_TRIGGERS = ["discount", "value", "plan", "below_floor"] as const;
export type ApprovalTrigger = (typeof APPROVAL_TRIGGERS)[number];
export const TRIGGER_LABELS: Record<ApprovalTrigger, string> = {
  discount: "Discount",
  value: "Final value",
  plan: "Payment plan outside the standard rule",
  below_floor: "Price below the floor rate",
};

export interface CrossedTrigger {
  key: ApprovalTrigger;
  level: 1 | 2 | 3;
  detail: string;
}

export interface TriggerInput {
  discountPercent: number;
  /** Annual fee before VAT. */
  finalPrice: number;
  plan: PaymentPlan;
  belowFloor: boolean;
}

const aed = (n: number) => `AED ${n.toLocaleString("en-AE", { maximumFractionDigits: 2 })}`;

/** The value level: the highest configured threshold the fee is above. */
export function valueApprovalLevel(approvals: AmcConfig["approvals"], finalPrice: number): 0 | 1 | 2 | 3 {
  const above = (limit: number | null) => limit !== null && finalPrice > limit;
  if (above(approvals.valueLevel3AboveAed)) return 3;
  if (above(approvals.valueLevel2AboveAed)) return 2;
  if (above(approvals.valueLevel1AboveAed)) return 1;
  return 0;
}

export function evaluateTriggers(config: Pick<AmcConfig, "approvals" | "payments">, input: TriggerInput): { triggers: CrossedTrigger[]; requiredLevel: 0 | 1 | 2 | 3 } {
  const { approvals, payments } = config;
  const triggers: CrossedTrigger[] = [];
  const discountLevel = discountApprovalLevel(approvals, input.discountPercent);
  if (discountLevel) triggers.push({ key: "discount", level: discountLevel, detail: `${input.discountPercent}% discount` });
  const valueLevel = valueApprovalLevel(approvals, input.finalPrice);
  if (valueLevel) triggers.push({ key: "value", level: valueLevel, detail: `${aed(input.finalPrice)} a year before VAT` });
  if (isNonStandardPlan(payments, input.finalPrice, input.plan)) {
    triggers.push({ key: "plan", level: approvals.nonStandardPlanLevel as 1 | 2 | 3, detail: `${PAYMENT_PLAN_LABELS[input.plan]} at this value` });
  }
  if (input.belowFloor) triggers.push({ key: "below_floor", level: approvals.belowFloorLevel as 1 | 2 | 3, detail: "A discounted line is under its floor rate" });
  const requiredLevel = triggers.reduce<number>((max, t) => Math.max(max, t.level), 0) as 0 | 1 | 2 | 3;
  return { triggers, requiredLevel };
}

/** What the previous version was approved for, if it went through the ladder. */
export interface PriorApproval {
  level: number;
  discountPercent: number;
  plan: string | null;
  belowFloor: boolean;
}

/** Whether the previous version's approval still covers this one (BRD 5.5: re-trigger on a higher discount or a plan change). */
export function priorApprovalCovers(prior: PriorApproval | null, now: TriggerInput & { requiredLevel: number }): boolean {
  if (!prior || now.requiredLevel === 0) return false;
  return (
    now.requiredLevel <= prior.level &&
    now.discountPercent <= prior.discountPercent + 1e-9 &&
    now.plan === prior.plan &&
    (!now.belowFloor || prior.belowFloor)
  );
}

/** The levels a proposal climbs: 1 up to the required one. */
export function ladderLevels(requiredLevel: number): number[] {
  return Array.from({ length: Math.max(0, Math.min(3, requiredLevel)) }, (_, i) => i + 1);
}

/**
 * Who decides a level: the people named for it in configuration, or, when
 * nobody is named, the AMC approvers (AMC Settings list or AMC Approve).
 * Never the proposal's owner.
 */
export function canDecideStep(input: { userId: string; ownerId: string; approverIds: readonly string[]; isAmcApprover: boolean }): boolean {
  if (input.userId === input.ownerId) return false;
  return input.approverIds.length > 0 ? input.approverIds.includes(input.userId) : input.isAmcApprover;
}

export const STEP_ACTIONS = ["approve", "reject", "return"] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

/* ------------------------------------------------------------------ */
/* Sharing (BRD 5.6, 6.1 Email 1)                                      */
/* ------------------------------------------------------------------ */

export const SHARE_CHANNELS = ["email", "whatsapp", "link"] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

/** WhatsApp for residential, email for commercial (BRD 5.6). */
export function defaultShareChannel(category: string | null | undefined): "email" | "whatsapp" {
  return category === "commercial" ? "email" : "whatsapp";
}

/** Fills `{Placeholder}` fields; a field with no value prints as nothing, and an empty line it leaves is dropped. */
export function fillTemplate(text: string, values: Record<string, string | number | null | undefined>): string {
  const filled = text.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    const value = values[key.trim()];
    return value === null || value === undefined ? "" : String(value);
  });
  return filled
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A number as WhatsApp wants it: digits only, country code first. Local
 * UAE forms (050…, 50…) get 971; an international one (+44…, 0044…) keeps
 * its own code.
 */
export function whatsappNumber(phone: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `971${digits.slice(1)}`;
  else if (/^5\d{8}$/.test(digits)) digits = `971${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function whatsappUrl(phone: string, text: string): string | null {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}

const recipient = z.object({ name: z.string().trim().max(200).default(""), address: z.string().trim().min(3).max(200) }).strict();

export const shareSchema = z
  .object({
    id: z.string().uuid(),
    channel: z.enum(SHARE_CHANNELS),
    recipients: z.array(recipient).max(10).default([]),
    /** Copy the proposal's owner (Email 1: copy coordinator). */
    ccOwner: z.boolean().default(true),
    pdf_base64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).optional(),
  })
  .strict()
  .refine((v) => v.channel === "link" || v.recipients.length > 0, { message: "Choose at least one contact", path: ["recipients"] })
  .refine((v) => v.channel !== "email" || v.recipients.every((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.address)), {
    message: "Every email recipient needs a valid address",
    path: ["recipients"],
  });

/* ------------------------------------------------------------------ */
/* The client's decision (BRD 5.6; DEV-370, 371)                       */
/* ------------------------------------------------------------------ */

export const CLIENT_ANSWERS = ["approved", "rejected", "revision_requested"] as const;
export type ClientAnswer = (typeof CLIENT_ANSWERS)[number];
export const CLIENT_ANSWER_LABELS: Record<ClientAnswer, string> = {
  approved: "Approved",
  rejected: "Rejected",
  revision_requested: "Revision requested",
};

/** A decision the coordinator records for an answer given outside the link, with its evidence. */
export const recordDecisionSchema = z
  .object({
    id: z.string().uuid(),
    answer: z.enum(CLIENT_ANSWERS),
    clientName: z.string().trim().min(2, "Who answered?").max(200),
    note: z.string().trim().max(1000).nullable().optional(),
    evidenceDocumentId: z.string().uuid("Attach the evidence (the email, message or signed page)"),
  })
  .strict()
  .refine((v) => v.answer === "approved" || !!v.note?.trim(), { message: "Say what the client asked for or why they declined", path: ["note"] });
