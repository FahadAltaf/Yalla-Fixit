import type { AmcConfig } from "./config";
import { TRIGGER_LABELS, type ApprovalTrigger } from "./approval-ladder";
import { allowedPaymentPlans, approvalLevelName, discountApprovalLevel, isNonStandardPlan, PAYMENT_PLAN_LABELS, type PaymentPlan } from "./proposal-rules";
import { lineBelowFloor } from "./rate-card";

/**
 * What the approver checks on a proposal (23 Nov 2026, the user: "show the
 * approver what needs checking: an issue in a rate, in the value... what is
 * against the rule"). One item per rule the proposal crosses, each saying
 * what the proposal asks for, what the rule allows and which level decides;
 * the floor rule names every line and why. Changed rates that need no
 * approval are listed too, for information.
 *
 * Pure, from the proposal as saved and the AMC configuration: the same rules
 * the ladder applies on submit (lib/amc/approval-ladder.ts evaluateTriggers).
 */

export type ApprovalCheckKey = ApprovalTrigger | "rate_changed";

export interface ApprovalCheckLine {
  service: string;
  /** What is wrong with the line, in a few words. */
  problem: string;
  /** The figures behind it. */
  detail: string;
  /** Why the rate was changed, as the person who changed it wrote. */
  reason?: string | null;
  by?: string | null;
}

export interface ApprovalCheck {
  key: ApprovalCheckKey;
  title: string;
  /** null: for information, no approval needed for it. */
  level: number | null;
  levelName: string | null;
  /** What this proposal asks for. */
  asked: string;
  /** What the rule allows without approval, and who approves more. */
  rule: string;
  lines: ApprovalCheckLine[];
}

/** The line fields the checklist reads (the saved services). */
export interface ChecklistLine {
  serviceId: string;
  included: boolean;
  free?: boolean;
  units?: number;
  frequency: number;
  basePrice: number | null;
  standardRate?: number | null;
  floorRate?: number | null;
  promotionPercent?: number | null;
  belowFloor?: boolean;
  rateOverride?: boolean;
  rateOverrideReason?: string | null;
  rateOverrideBy?: string | null;
  frequencyOffCard?: boolean;
  cardFrequencies?: number[] | null;
}

export interface ChecklistInput {
  discountPercent: number;
  /** Annual fee before VAT. */
  finalPrice: number;
  plan: PaymentPlan;
  /** The custom plan in words, when the plan is custom. */
  planLabel?: string | null;
  services: readonly ChecklistLine[];
  labelOf: (line: ChecklistLine) => string;
}

const aed = (n: number) => `AED ${n.toLocaleString("en-AE", { maximumFractionDigits: 2 })}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "No approval up to 10%; above 10%: AMC department head; above 20%: Management." */
function ladderText(
  approvals: AmcConfig["approvals"],
  limits: Array<number | null>,
  show: (n: number) => string,
  none: string,
): string {
  const steps = limits
    .map((limit, i) => (limit === null ? null : `above ${show(limit)}: ${approvalLevelName(approvals, i + 1)}`))
    .filter((s): s is string => Boolean(s));
  const first = limits.find((l) => l !== null);
  if (first === undefined || first === null) return none;
  return `No approval up to ${show(first)}; ${steps.join("; ")}.`;
}

export function approvalChecklist(config: Pick<AmcConfig, "approvals" | "payments">, input: ChecklistInput): ApprovalCheck[] {
  const { approvals, payments } = config;
  const checks: ApprovalCheck[] = [];
  const level = (n: number) => ({ level: n, levelName: approvalLevelName(approvals, n) });

  /* Discount */
  const discountLevel = discountApprovalLevel(approvals, input.discountPercent);
  if (discountLevel) {
    checks.push({
      key: "discount",
      title: "Discount above the limit",
      ...level(discountLevel),
      asked: `${round2(input.discountPercent)}% discount on the whole proposal`,
      rule: ladderText(
        approvals,
        [approvals.discountLevel1AbovePercent, approvals.discountLevel2AbovePercent, approvals.discountLevel3AbovePercent],
        (n) => `${n}%`,
        "Any discount needs approval.",
      ),
      lines: [],
    });
  }

  /* Value */
  const valueLimits = [approvals.valueLevel1AboveAed, approvals.valueLevel2AboveAed, approvals.valueLevel3AboveAed];
  const valueLevel = valueLimits.reduce<number>((max, limit, i) => (limit !== null && input.finalPrice > limit ? i + 1 : max), 0);
  if (valueLevel) {
    checks.push({
      key: "value",
      title: "Contract value above the limit",
      ...level(valueLevel),
      asked: `${aed(input.finalPrice)} a year before VAT`,
      rule: ladderText(approvals, valueLimits, aed, "Every value needs approval."),
      lines: [],
    });
  }

  /* Payment plan */
  if (isNonStandardPlan(payments, input.finalPrice, input.plan)) {
    const standard = allowedPaymentPlans(payments, input.finalPrice).filter((p) => p !== "custom");
    checks.push({
      key: "plan",
      title: TRIGGER_LABELS.plan,
      ...level(approvals.nonStandardPlanLevel),
      asked: input.plan === "custom" && input.planLabel ? `Custom plan: ${input.planLabel}` : PAYMENT_PLAN_LABELS[input.plan],
      rule:
        input.plan === "custom"
          ? `A custom plan always needs approval. At ${aed(input.finalPrice)} the standard ${standard.length === 1 ? "plan is" : "plans are"} ${standard.map((p) => PAYMENT_PLAN_LABELS[p]).join(", ")}.`
          : `At ${aed(input.finalPrice)} a year the standard ${standard.length === 1 ? "plan is" : "plans are"} ${standard.map((p) => PAYMENT_PLAN_LABELS[p]).join(", ")} (one payment below ${aed(payments.singlePaymentBelowAed)}).`,
      lines: [],
    });
  }

  /* The floor: every line, and why */
  const floorLines: ApprovalCheckLine[] = [];
  const infoLines: ApprovalCheckLine[] = [];
  for (const line of input.services) {
    if (!line.included || line.free) continue;
    const service = input.labelOf(line);
    const reason = line.rateOverrideReason?.trim() || null;
    const by = line.rateOverrideBy ?? null;
    const base = line.basePrice;
    const floor = line.floorRate ?? null;
    const standard = line.standardRate ?? null;
    if (line.belowFloor) {
      if (line.rateOverride && floor === null && base !== null) {
        floorLines.push({ service, problem: "Rate not on the rate card", detail: `${aed(base)} typed on the proposal; the card has no rate for this service on this property.`, reason, by });
      } else if (line.rateOverride && floor !== null && base !== null && base + 1e-9 < floor) {
        floorLines.push({
          service,
          problem: "Rate typed under the floor",
          detail: `${aed(base)} typed; the floor is ${aed(floor)}${standard !== null ? ` and the standard rate ${aed(standard)}` : ""}.`,
          reason,
          by,
        });
      } else if (floor !== null && base !== null && lineBelowFloor(base, floor, input.discountPercent)) {
        const effective = round2(base * (1 - input.discountPercent / 100));
        floorLines.push({
          service,
          problem: "Under the floor after the discount",
          detail: `${aed(base)}${line.promotionPercent ? ` (after a ${line.promotionPercent}% promotion)` : ""} less the ${round2(input.discountPercent)}% discount is ${aed(effective)}; the floor is ${aed(floor)}.`,
          reason: line.rateOverride ? reason : null,
          by: line.rateOverride ? by : null,
        });
      }
      if (line.frequencyOffCard) {
        const card = (line.cardFrequencies ?? []).filter((n) => Number.isFinite(n));
        floorLines.push({
          service,
          problem: "Visits a year not on the rate card",
          detail: `${line.frequency} a year${card.length ? `; the card offers ${card.join(", ")}` : ""}.`,
        });
      }
    } else if (line.rateOverride && base !== null && standard !== null && Math.abs(base - standard) > 1e-9) {
      /* Changed and still within the rules: for information. */
      infoLines.push({
        service,
        problem: base > standard ? "Rate raised above the standard" : "Rate lowered, within the floor",
        detail: `${aed(base)} instead of the standard ${aed(standard)}${floor !== null ? `; floor ${aed(floor)}` : ""}.`,
        reason,
        by,
      });
    }
  }
  if (floorLines.length) {
    checks.push({
      key: "below_floor",
      title: "Lines against the rate card",
      ...level(approvals.belowFloorLevel),
      asked: `${floorLines.length} ${floorLines.length === 1 ? "line" : "lines"} under the floor rate or off the rate card`,
      rule: "Every line at or above its floor rate, after the discount, and on the card's rates and visits a year. A promotion alone never counts.",
      lines: floorLines,
    });
  }
  if (infoLines.length) {
    checks.push({
      key: "rate_changed",
      title: "Rates changed on this proposal",
      level: null,
      levelName: null,
      asked: `${infoLines.length} ${infoLines.length === 1 ? "rate" : "rates"} changed from the card`,
      rule: "Within the rules, so no approval is needed for these; shown so the approver sees every change.",
      lines: infoLines,
    });
  }
  return checks;
}
