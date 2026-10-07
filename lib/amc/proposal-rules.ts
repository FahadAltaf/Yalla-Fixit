import { z } from "zod";

import type { AmcConfig } from "./config";
import { UNIT_TYPE_CATEGORY, type UNIT_TYPES } from "./client-profile";
import type { PropertyModel } from "./rate-card";

/**
 * Proposal rules added by BRD v0.3 (5.4, 5.8; DEV-365, 366, 367): versions,
 * payment plans, validity, property types and discount authority. Pure.
 */

/* ------------------------------------------------------------------ */
/* Versions (DEV-367)                                                  */
/* ------------------------------------------------------------------ */

export const VERSION_REASONS = ["scope_up", "scope_down", "discount", "price_correction", "frequency", "duration", "payment_plan", "other"] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];
export const VERSION_REASON_LABELS: Record<VersionReason, string> = {
  scope_up: "Scope up",
  scope_down: "Scope down",
  discount: "Discount",
  price_correction: "Price correction",
  frequency: "Frequency",
  duration: "Duration",
  payment_plan: "Payment plan",
  other: "Other",
};

/**
 * Shared with the client, so an edit makes a new version rather than
 * changing what they saw. A proposal the client approved is locked (BRD 5.6).
 */
export const REVISABLE_STATUSES = ["proposal_sent", "proposal_rejected"] as const;

export function canRevise(status: string, isOwner: boolean): boolean {
  return isOwner && (REVISABLE_STATUSES as readonly string[]).includes(status);
}

export const reviseSchema = z
  .object({
    id: z.string().uuid(),
    reason: z.enum(VERSION_REASONS),
    summary: z.string().trim().min(5, "Say in a sentence what changes").max(1000),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* Payment plans (DEV-366, issue #8)                                   */
/* ------------------------------------------------------------------ */

export const PAYMENT_PLANS = ["single", "fifty_fifty", "quarterly", "monthly", "custom"] as const;
export type PaymentPlan = (typeof PAYMENT_PLANS)[number];
export const PAYMENT_PLAN_LABELS: Record<PaymentPlan, string> = {
  single: "Single payment",
  fifty_fifty: "50/50",
  quarterly: "Quarterly",
  monthly: "Monthly",
  custom: "Custom",
};

export const customPlanSchema = z
  .array(
    z
      .object({
        label: z.string().trim().min(1, "Name each instalment").max(80),
        percent: z.number().gt(0).max(100),
      })
      .strict(),
  )
  .min(2, "A custom plan has at least two instalments")
  .max(12)
  .refine((rows) => Math.abs(rows.reduce((s, r) => s + r.percent, 0) - 100) < 0.01, { message: "The instalments must add up to 100%" });
export type CustomPlan = z.infer<typeof customPlanSchema>;

type LegacyTerms = "monthly" | "quarterly" | "annual";

/** An older proposal's terms as a plan (annual was one payment a year). */
export function planFromLegacyTerms(terms: string | null | undefined): PaymentPlan {
  return terms === "monthly" ? "monthly" : terms === "quarterly" ? "quarterly" : "single";
}

/**
 * The value kept in `customer.paymentTerms` for live `main`, which still
 * prints that field and knows only these three. The proposal's own plan is
 * `payment_plan`; this is a compatible reading of it.
 */
export function legacyTermsForPlan(plan: PaymentPlan): LegacyTerms {
  return plan === "monthly" ? "monthly" : plan === "quarterly" ? "quarterly" : "annual";
}

export function paymentPlanLabel(plan: PaymentPlan, custom?: CustomPlan | null): string {
  if (plan === "custom" && custom?.length) return custom.map((r) => `${r.percent}% ${r.label}`).join(", ");
  return PAYMENT_PLAN_LABELS[plan];
}

/**
 * The plans offered at this value (BRD 5.8, plan Q6): one payment below the
 * band; above it the configured plans, plus a custom plan when allowed.
 */
export function allowedPaymentPlans(payments: AmcConfig["payments"], finalPrice: number): PaymentPlan[] {
  if (finalPrice < payments.singlePaymentBelowAed) return ["single"];
  return [...payments.plansAboveBand, ...(payments.customPlanAllowed ? (["custom"] as const) : [])];
}

/** The plan a new proposal starts with at this value. */
export function defaultPaymentPlan(payments: AmcConfig["payments"], finalPrice: number): PaymentPlan {
  return finalPrice < payments.singlePaymentBelowAed ? "single" : payments.defaultPlanAboveBand;
}

/** A plan outside the band's standard plans (an approval trigger in Phase 5). */
export function isNonStandardPlan(payments: AmcConfig["payments"], finalPrice: number, plan: PaymentPlan): boolean {
  if (plan === "custom") return true;
  return !allowedPaymentPlans(payments, finalPrice).includes(plan);
}

/* ------------------------------------------------------------------ */
/* Discount authority (BRD 5.3, 5.5)                                    */
/* ------------------------------------------------------------------ */

export type DiscountThresholds = Pick<AmcConfig["approvals"], "discountLevel1AbovePercent" | "discountLevel2AbovePercent" | "discountLevel3AbovePercent">;

/** The approval level a discount needs (0 = within anyone's authority), from the configured thresholds. */
export function discountApprovalLevel(approvals: DiscountThresholds, discountPercent: number): 0 | 1 | 2 | 3 {
  const above = (limit: number | null) => limit !== null && discountPercent > limit;
  if (above(approvals.discountLevel3AbovePercent)) return 3;
  if (above(approvals.discountLevel2AbovePercent)) return 2;
  if (above(approvals.discountLevel1AbovePercent)) return 1;
  return 0;
}

export function approvalLevelName(approvals: Pick<AmcConfig["approvals"], "level1Name" | "level2Name" | "level3Name">, level: number): string {
  return level === 1 ? approvals.level1Name : level === 2 ? approvals.level2Name : level === 3 ? approvals.level3Name : "";
}

/* ------------------------------------------------------------------ */
/* Validity (DEV-366) and property types (DEV-365)                     */
/* ------------------------------------------------------------------ */

/** The day a proposal sent at `sentAt` stops being valid: its Dubai date plus the configured days. */
export function proposalValidUntil(sentAt: string | Date, validityDays: number): string {
  const day = new Date(sentAt).toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + validityDays);
  return d.toISOString().slice(0, 10);
}

export type PropertyType = (typeof UNIT_TYPES)[number];

/**
 * The rate model a property type is priced on. Villas and townhouses are
 * villas; apartments are apartments; every commercial type is priced as an
 * office (plan assumption: rates by model until the card says otherwise).
 * "Other" follows its category.
 */
export function rateModelFor(propertyType: PropertyType | string | null | undefined, category?: string | null): PropertyModel {
  switch (propertyType) {
    case "villa":
    case "townhouse":
      return "villa";
    case "apartment":
      return "apartment";
    case "other":
    case null:
    case undefined:
      return category === "commercial" ? "office" : category === "residential" ? "apartment" : "villa";
    default:
      return "office";
  }
}

/** The category a property type usually belongs to. */
export function categoryForType(propertyType: PropertyType): "residential" | "commercial" | null {
  return UNIT_TYPE_CATEGORY[propertyType];
}
