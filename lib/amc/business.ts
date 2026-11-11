/**
 * AMC business operations: customers and properties, assessments,
 * additional-service eligibility, and the reporting maths. Pure: no
 * database, no React. The server reads rows and passes them in.
 *
 * Rules that are business policy and not yet decided are configuration
 * (passed in, with conservative defaults) and marked as such.
 */
import {
  checkCoverage,
  contractDisplayStatus,
  daysRemaining,
  isExhausted,
  remainingQuantity,
  type ContractEntitlement,
  type ContractForRules,
  type EntitlementType,
  type StoredContractStatus,
} from "./contracts";
import { discountedPrice } from "./additional-service-discount";
import { filsToAed, toFils } from "./pricing";

/* ------------------------------------------------------------------ */
/* Customers and properties: snapshot vs live record                    */
/* ------------------------------------------------------------------ */

/* BRD v0.3 5.2 (Phase 2): the full list, shared with the property form. */
export const PROPERTY_UNIT_TYPES = ["villa", "apartment", "townhouse", "restaurant", "clinic", "shop", "office", "warehouse", "other"] as const;
export type PropertyUnitType = (typeof PROPERTY_UNIT_TYPES)[number];
/** The unit types the AMC proposal wizard and pricing know. */
export const AMC_PROPOSAL_UNIT_TYPES = ["villa", "apartment", "office"] as const;

type Snapshot = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * A shared customer record pre-filled from a contract's signed snapshot,
 * for staff to confirm. The snapshot itself is never changed.
 */
export function customerFromSnapshot(customer: Snapshot) {
  return {
    name: text(customer.customerName) ?? "",
    customerRef: text(customer.customerId),
    email: text(customer.customerEmail),
    phone: text(customer.customerPhone),
  };
}

/** A shared property record pre-filled from a contract's signed snapshot. */
export function propertyFromSnapshot(property: Snapshot) {
  const unit = text(property.unitType);
  const category = text(property.propertyCategory);
  return {
    label: text(property.propertyDetail) ?? text(property.propertyAddress) ?? "",
    address: text(property.propertyAddress),
    unitType: (PROPERTY_UNIT_TYPES as readonly string[]).includes(unit ?? "") ? (unit as PropertyUnitType) : null,
    propertyCategory: category === "residential" || category === "commercial" ? category : null,
  };
}

/* ------------------------------------------------------------------ */
/* Assessments                                                          */
/* ------------------------------------------------------------------ */

export type AssessmentResult = "ok" | "attention" | "not_applicable";

export interface AssessmentItemState {
  itemKey: string;
  categoryKey: string;
  categoryLabel: string;
  label: string;
  result: AssessmentResult | null;
  notes: string | null;
}

export function assessmentSummary(items: ReadonlyArray<Pick<AssessmentItemState, "result" | "label" | "categoryLabel">>) {
  const count = (r: AssessmentResult | null) => items.filter((i) => i.result === r).length;
  return {
    total: items.length,
    ok: count("ok"),
    attention: count("attention"),
    notApplicable: count("not_applicable"),
    unanswered: count(null),
    attentionItems: items.filter((i) => i.result === "attention").map((i) => `${i.categoryLabel}: ${i.label}`),
  };
}

export type AssessmentCompletionCheck = { ok: true } | { ok: false; errors: string[] };

/**
 * May the assessment be completed? It needs a date, a property, and an
 * answer for every checklist item (Not applicable counts as an answer). A
 * site visit the client missed or that was cancelled is not completed as
 * if it happened (DEV-362); attendance is optional for walk-in assessments.
 */
export function checkAssessmentCompletion(input: {
  status: "draft" | "completed";
  assessedOn: string | null;
  propertyId: string | null;
  items: ReadonlyArray<Pick<AssessmentItemState, "result">>;
  attendance?: string | null;
}): AssessmentCompletionCheck {
  if (input.status === "completed") return { ok: false, errors: ["This assessment is already completed."] };
  const errors: string[] = [];
  if (!input.assessedOn) errors.push("Enter the assessment date.");
  if (!input.propertyId) errors.push("Choose the property.");
  if (input.attendance && input.attendance !== "attended") errors.push("The visit did not take place: record it as attended, or book a new visit.");
  const unanswered = input.items.filter((i) => i.result === null).length;
  if (input.items.length === 0) errors.push("The checklist is empty.");
  else if (unanswered > 0) errors.push(`${unanswered} checklist item${unanswered === 1 ? " is" : "s are"} not answered.`);
  return errors.length ? { ok: false, errors } : { ok: true };
}

export interface AssessmentForProposal {
  status: "draft" | "completed";
  submissionId: string | null;
  recommendedServiceIds: ReadonlyArray<string>;
  unitType: string | null;
  propertyCategory: string | null;
  /** Units counted on site per service (site visit, DEV-362); a ticked service without a count is 1 unit. */
  assetCounts?: Readonly<Record<string, number>>;
}

export interface CustomerForProposal {
  name: string;
  customerRef: string | null;
  email: string | null;
  phone: string | null;
}

export interface PropertyForProposal {
  label: string;
  address: string | null;
  unitType: string | null;
  propertyCategory: string | null;
}

export type ProposalPrefill =
  | {
      ok: true;
      property: { propertyCategory: string; unitType: string; propertyAddress: string; propertyDetail: string };
      customer: Record<string, unknown>;
      /** Recommended services the catalogue offers on this unit type: ticked, unpriced. */
      services: Array<{ serviceId: string; included: boolean; units: number; frequency: number; basePrice: null; price: 0 }>;
      /** Recommended but not offered on this unit type. */
      droppedServiceIds: string[];
    }
  | { ok: false; status: 409; error: string };

/**
 * The AMC proposal draft a completed assessment can start: the customer,
 * the property and the recommended services, nothing more. Prices are left
 * empty for the normal pricing in the proposal wizard; the assessment's
 * findings never set a price.
 */
export function proposalPrefillFromAssessment(
  assessment: AssessmentForProposal,
  customer: CustomerForProposal | null,
  property: PropertyForProposal | null,
  offered: ReadonlyArray<{ id: string; frequencyPerYear?: number | null }>,
): ProposalPrefill {
  if (assessment.status !== "completed") return { ok: false, status: 409, error: "Complete the assessment first." };
  if (assessment.submissionId) return { ok: false, status: 409, error: "A proposal was already created from this assessment." };
  if (!property) return { ok: false, status: 409, error: "The assessment has no property." };
  const unitType = property.unitType ?? assessment.unitType;
  if (!unitType || !(AMC_PROPOSAL_UNIT_TYPES as readonly string[]).includes(unitType)) {
    return {
      ok: false,
      status: 409,
      error: "AMC proposals cover villas, apartments and offices. Set the property's unit type to one of these first.",
    };
  }
  const category = property.propertyCategory ?? assessment.propertyCategory ?? (unitType === "office" ? "commercial" : "residential");
  const offeredIds = new Set(offered.map((s) => s.id));
  const recommended = [...new Set(assessment.recommendedServiceIds)];
  const services = offered.map((s) => ({
    serviceId: s.id,
    included: recommended.includes(s.id),
    units: recommended.includes(s.id) ? Math.max(1, Math.trunc(assessment.assetCounts?.[s.id] ?? 1)) : 1,
    frequency: s.frequencyPerYear && s.frequencyPerYear >= 1 ? Math.trunc(s.frequencyPerYear) : 1,
    basePrice: null as null,
    price: 0 as const,
  }));
  return {
    ok: true,
    property: {
      propertyCategory: category,
      unitType,
      propertyAddress: property.address ?? property.label,
      propertyDetail: property.label,
    },
    customer: {
      customerName: customer?.name ?? "",
      customerId: customer?.customerRef ?? "",
      customerPhone: customer?.phone ?? "",
      customerEmail: customer?.email ?? "",
      coordinationContacts: [
        { name: "", phone: "", designation: "owner" },
        { name: "", phone: "", designation: "owner" },
      ],
      /* Dates are agreed in the wizard, not taken from the assessment. */
      startDate: "",
      endDate: "",
      paymentTerms: "annual",
      proposalNumber: "",
    },
    services,
    droppedServiceIds: recommended.filter((id) => !offeredIds.has(id)),
  };
}

/* ------------------------------------------------------------------ */
/* Additional services                                                  */
/* ------------------------------------------------------------------ */

export interface DiscountConfig {
  enabled: boolean;
  discountPercent: number | null;
  /** Only listed services/categories qualify; empty lists mean none. */
  eligibleServiceKeys: ReadonlyArray<string>;
  eligibleCategories: ReadonlyArray<string>;
}

export type AdditionalServiceOutcome =
  | "included_in_amc"
  | "amc_discount_eligible"
  | "standard_charge"
  | "not_configured";

export interface AdditionalServiceEligibility {
  outcome: AdditionalServiceOutcome;
  contractInForce: boolean;
  /** The service is on the contract with allowance left (or unlimited / included). */
  includedInContract: boolean;
  discountPercent: number;
  standardPrice: number | null;
  discountAmount: number;
  finalPrice: number | null;
  reasons: string[];
}

/**
 * For a requested additional service on a contract and date: is it already
 * covered, does the AMC discount apply, and what would it cost. The rate is
 * configuration (BUSINESS DECISION REQUIRED); nothing assumes 25%.
 */
export function additionalServiceEligibility(input: {
  contract: ContractForRules;
  /** The AMC catalogue service it corresponds to, if any (to check inclusion). */
  amcServiceId: string | null;
  serviceKey: string;
  category: string | null;
  date: string;
  standardPrice: number | null;
  config: DiscountConfig;
}): AdditionalServiceEligibility {
  const reasons: string[] = [];
  const standard = input.standardPrice === null ? null : filsToAed(toFils(Math.max(0, input.standardPrice)));
  const base = { discountPercent: 0, standardPrice: standard, discountAmount: 0, finalPrice: standard };

  const coverage = checkCoverage([input.contract], { serviceId: input.amcServiceId ?? "__none__", date: input.date });
  const inForce = coverage.amcStatus === "active";
  if (!inForce) {
    reasons.push(coverage.reason);
    return { outcome: "standard_charge", contractInForce: false, includedInContract: false, ...base, reasons };
  }

  if (input.amcServiceId && coverage.covered) {
    /* Covered, not discounted: nothing to charge and nothing to quote. */
    reasons.push("Already covered by the AMC: record it as usage; no quotation is needed.");
    return {
      outcome: "included_in_amc",
      contractInForce: true,
      includedInContract: true,
      discountPercent: 0,
      standardPrice: standard,
      discountAmount: 0,
      finalPrice: 0,
      reasons,
    };
  }
  if (input.amcServiceId && coverage.outcome === "exhausted") {
    reasons.push("On the AMC, but the allowance is used up: this one is chargeable.");
  }

  const rate = input.config.discountPercent;
  if (!input.config.enabled || rate === null || !(rate > 0)) {
    reasons.push("No AMC discount on additional services is configured.");
    return { outcome: "not_configured", contractInForce: true, includedInContract: false, ...base, reasons };
  }
  const eligible =
    input.config.eligibleServiceKeys.includes(input.serviceKey) ||
    (!!input.category && input.config.eligibleCategories.includes(input.category));
  if (!eligible) {
    reasons.push("This service is not on the AMC discount list.");
    return { outcome: "standard_charge", contractInForce: true, includedInContract: false, ...base, reasons };
  }
  reasons.push(`AMC discount ${rate}% applies.`);
  if (standard === null) {
    reasons.push("Enter the standard price to work out the discounted price.");
    return {
      outcome: "amc_discount_eligible",
      contractInForce: true,
      includedInContract: false,
      discountPercent: rate,
      standardPrice: null,
      discountAmount: 0,
      finalPrice: null,
      reasons,
    };
  }
  const final = discountedPrice(standard, rate);
  return {
    outcome: "amc_discount_eligible",
    contractInForce: true,
    includedInContract: false,
    discountPercent: rate,
    standardPrice: standard,
    discountAmount: filsToAed(toFils(standard) - toFils(final)),
    finalPrice: final,
    reasons,
  };
}

/* ------------------------------------------------------------------ */
/* Expiry report                                                        */
/* ------------------------------------------------------------------ */

export type ExpiryBucket = "expired" | "d0_30" | "d31_60" | "d61_90" | "d90_plus";

export const EXPIRY_BUCKET_LABELS: Record<ExpiryBucket, string> = {
  expired: "Expired",
  d0_30: "0–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "90+ days",
};

/** Which expiry bucket a contract is in today; null for cancelled ones. */
export function expiryBucket(
  contract: { status: StoredContractStatus; endDate: string },
  today: string,
): ExpiryBucket | null {
  if (contract.status === "cancelled") return null;
  const days = daysRemaining(contract.endDate, today);
  if (days === null) return null;
  if (days < 0) return "expired";
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

/* ------------------------------------------------------------------ */
/* Renewal pipeline                                                     */
/* ------------------------------------------------------------------ */

/**
 * Days before the end date from which a contract enters the renewal
 * pipeline. Configuration default, not a business rule.
 */
export const RENEWAL_PIPELINE_WINDOW_DAYS = 90;

export type RenewalStage =
  | "upcoming"
  | "proposal_created"
  | "awaiting_internal_approval"
  | "approved_not_sent"
  | "sent_to_customer"
  | "rejected_by_customer"
  | "approved_by_customer"
  | "contract_sent"
  | "signed"
  | "renewed"
  | "expired_without_renewal";

export const RENEWAL_STAGE_LABELS: Record<RenewalStage, string> = {
  upcoming: "Upcoming",
  proposal_created: "Renewal proposal created",
  awaiting_internal_approval: "Awaiting internal approval",
  approved_not_sent: "Approved, not sent",
  sent_to_customer: "Sent to customer",
  rejected_by_customer: "Rejected by customer",
  approved_by_customer: "Approved by customer",
  contract_sent: "Contract sent",
  signed: "Signed, not activated",
  renewed: "Renewed",
  expired_without_renewal: "Expired without renewal",
};

const STAGE_BY_PROPOSAL_STATUS: Record<string, RenewalStage> = {
  draft: "proposal_created",
  sent_back: "proposal_created",
  awaiting_approval: "awaiting_internal_approval",
  approved: "approved_not_sent",
  proposal_sent: "sent_to_customer",
  proposal_rejected: "rejected_by_customer",
  proposal_approved: "approved_by_customer",
  contract_sent: "contract_sent",
  signed: "signed",
};

/**
 * A contract's place in the renewal pipeline, derived from the contract
 * and its renewal proposal: no separate status is kept. Null: not in the
 * pipeline (cancelled, or far from expiry with nothing started).
 */
export function renewalStage(
  input: {
    status: StoredContractStatus;
    endDate: string;
    renewedByContractId: string | null;
    renewalProposalStatus: string | null;
  },
  today: string,
  windowDays = RENEWAL_PIPELINE_WINDOW_DAYS,
): { stage: RenewalStage; overdue: boolean } | null {
  if (input.status === "cancelled") return null;
  const days = daysRemaining(input.endDate, today);
  const expired = days !== null && days < 0;
  if (input.renewedByContractId) return { stage: "renewed", overdue: false };
  if (input.renewalProposalStatus) {
    const stage = STAGE_BY_PROPOSAL_STATUS[input.renewalProposalStatus] ?? "proposal_created";
    return { stage, overdue: expired };
  }
  if (expired) return { stage: "expired_without_renewal", overdue: true };
  if (days !== null && days <= windowDays) return { stage: "upcoming", overdue: false };
  return null;
}

/* ------------------------------------------------------------------ */
/* Reporting maths                                                      */
/* ------------------------------------------------------------------ */

export interface ReportContract {
  id: string;
  status: StoredContractStatus;
  startDate: string;
  endDate: string;
  grandTotal: number;
  customerId: string | null;
  propertyId: string | null;
  accountManagers: ReadonlyArray<string>;
  renewedFromContractId: string | null;
  renewedByContractId: string | null;
  renewalProposalStatus: string | null;
  entitlements: ReadonlyArray<
    Pick<ContractEntitlement, "serviceId" | "serviceLabel" | "entitlementType" | "includedQuantity" | "usedQuantity">
  >;
}

/** In force today: active, started, not past its end date. */
export function inForce(c: Pick<ReportContract, "status" | "startDate" | "endDate">, today: string): boolean {
  const s = contractDisplayStatus(c, today);
  return s === "active" || s === "expiring";
}

const LOW_FRACTION = 0.25;

/**
 * The portfolio figures. Customers and properties are counted by their
 * linked record, once each; contracts not linked to a customer or property
 * are counted separately, never guessed into a total.
 */
export function portfolioMetrics(contracts: ReadonlyArray<ReportContract>, today: string) {
  const live = contracts.filter((c) => inForce(c, today));
  const customers = new Set(live.map((c) => c.customerId).filter((x): x is string => Boolean(x)));
  const properties = new Set(live.map((c) => c.propertyId).filter((x): x is string => Boolean(x)));
  const low = live.filter((c) =>
    c.entitlements.some((e) => {
      if (e.entitlementType !== "visits" && e.entitlementType !== "hours") return false;
      const left = remainingQuantity(e) ?? 0;
      return left > 0 && (e.includedQuantity ?? 0) > 0 && left / (e.includedQuantity ?? 1) <= LOW_FRACTION;
    }),
  );
  return {
    inForce: live.length,
    inForceValue: filsToAed(live.reduce((sum, c) => sum + toFils(c.grandTotal), 0)),
    renewed: contracts.filter((c) => c.renewedByContractId).length,
    renewalsStarted: contracts.filter((c) => c.status !== "cancelled" && c.renewalProposalStatus && !c.renewedByContractId).length,
    withExhausted: live.filter((c) => c.entitlements.some((e) => isExhausted(e))).length,
    withLowRemaining: low.length,
    customersWithAmc: customers.size,
    contractsWithoutCustomer: live.filter((c) => !c.customerId).length,
    propertiesCovered: properties.size,
    contractsWithoutProperty: live.filter((c) => !c.propertyId).length,
  };
}

export interface ServiceAnalyticsRow {
  serviceId: string;
  serviceLabel: string;
  entitlementType: EntitlementType;
  /** In-force contracts that include it. */
  contracts: number;
  /** Visits or hours only, in that unit; null for unlimited/informational. */
  included: number | null;
  used: number;
  exhausted: number;
}

/**
 * Per service AND entitlement type, over in-force contracts: never adds
 * hours to visits. Unlimited services report their use count only.
 */
export function serviceAnalytics(contracts: ReadonlyArray<ReportContract>, today: string): ServiceAnalyticsRow[] {
  const rows = new Map<string, ServiceAnalyticsRow>();
  for (const c of contracts) {
    if (!inForce(c, today)) continue;
    for (const e of c.entitlements) {
      const key = `${e.serviceId}|${e.entitlementType}`;
      const row = rows.get(key) ?? {
        serviceId: e.serviceId,
        serviceLabel: e.serviceLabel,
        entitlementType: e.entitlementType,
        contracts: 0,
        included: e.entitlementType === "visits" || e.entitlementType === "hours" ? 0 : null,
        used: 0,
        exhausted: 0,
      };
      row.contracts += 1;
      if (row.included !== null) row.included = Math.round((row.included + (e.includedQuantity ?? 0)) * 100) / 100;
      row.used = Math.round((row.used + e.usedQuantity) * 100) / 100;
      if (isExhausted(e)) row.exhausted += 1;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.contracts - a.contracts || a.serviceLabel.localeCompare(b.serviceLabel));
}

export interface ManagerPortfolioRow {
  manager: string;
  inForce: number;
  expiringWithin90: number;
  renewalsInProgress: number;
  inForceValue: number;
  propertiesCovered: number;
  contractsWithoutProperty: number;
}

/**
 * Per account manager named on the signed contract. A contract with two
 * managers appears under both (and the totals per manager are theirs, not
 * a share). Contracts without a named manager are grouped as "Unassigned".
 */
export function managerPortfolio(contracts: ReadonlyArray<ReportContract>, today: string): ManagerPortfolioRow[] {
  const rows = new Map<string, ManagerPortfolioRow & { props: Set<string> }>();
  for (const c of contracts) {
    if (c.status === "cancelled") continue;
    const managers = c.accountManagers.length ? c.accountManagers : ["Unassigned"];
    const live = inForce(c, today);
    const days = daysRemaining(c.endDate, today);
    for (const m of managers) {
      const row =
        rows.get(m) ??
        { manager: m, inForce: 0, expiringWithin90: 0, renewalsInProgress: 0, inForceValue: 0, propertiesCovered: 0, contractsWithoutProperty: 0, props: new Set<string>() };
      if (live) {
        row.inForce += 1;
        row.inForceValue = filsToAed(toFils(row.inForceValue) + toFils(c.grandTotal));
        if (c.propertyId) row.props.add(c.propertyId);
        else row.contractsWithoutProperty += 1;
        if (days !== null && days <= 90) row.expiringWithin90 += 1;
      }
      if (c.renewalProposalStatus && !c.renewedByContractId) row.renewalsInProgress += 1;
      rows.set(m, row);
    }
  }
  return [...rows.values()]
    .map(({ props, ...r }) => ({ ...r, propertiesCovered: props.size }))
    .sort((a, b) => b.inForce - a.inForce || a.manager.localeCompare(b.manager));
}
