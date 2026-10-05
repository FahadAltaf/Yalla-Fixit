/**
 * Active AMC: the rules for operational contracts.
 *
 * Pure functions, no imports beyond the pricing helpers: shared by the
 * API (lib/server/amc/contracts.ts), the screens and the tests.
 *
 *   signed proposal --activate--> contract (stored status: active)
 *   active --cancel (reason)--> cancelled
 *
 * Everything else a coordinator sees is derived, never stored, so it
 * cannot go stale:
 *   not_started  active, start date still ahead
 *   active       running
 *   expiring     running, ending within the configured window
 *   expired      past its end date
 *   cancelled    stopped by a person
 * plus "renewed" when a later contract renews it, and
 * "pending_activation" for a signed proposal with no contract yet.
 */
import { computeAmcPricing, filsToAed, roundAed, toFils } from "./pricing";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type EntitlementType = "visits" | "hours" | "unlimited" | "informational";
export type CallOutClass = "emergency" | "non_emergency";
export type StoredContractStatus = "active" | "cancelled";
export type ContractDisplayStatus =
  | "pending_activation"
  | "not_started"
  | "active"
  | "expiring"
  | "expired"
  | "cancelled";

export interface ContractEntitlement {
  id?: string;
  serviceId: string;
  serviceLabel: string;
  entitlementType: EntitlementType;
  callOutClass: CallOutClass | null;
  units: number;
  frequency: number;
  includedQuantity: number | null;
  usedQuantity: number;
  basePrice: number | null;
  contractedPrice: number;
  frequencyType?: string | null;
  sortOrder?: number;
}

export interface ContractForRules {
  id?: string;
  status: StoredContractStatus;
  startDate: string; // yyyy-MM-dd
  endDate: string; // yyyy-MM-dd
  customerRef?: string | null;
  renewedByContractId?: string | null;
  entitlements: ContractEntitlement[];
}

/* ------------------------------------------------------------------ */
/* Configuration (business decisions are marked)                       */
/* ------------------------------------------------------------------ */

/**
 * How a service's frequency type in the signed settings maps to an
 * entitlement. Derived from the AMC catalogue's own types:
 *   covered    -> informational (e.g. the helpdesk: part of the contract,
 *                 never consumed)
 *   unlimited  -> unlimited (emergency call-outs)
 *   ppm        -> visits (planned maintenance visits a year)
 *   fixed      -> visits (counted jobs: water tank cleaning, the free
 *                 non-emergency call-outs)
 *   handyman   -> hours
 */
export const ENTITLEMENT_TYPE_BY_FREQUENCY_TYPE: Record<string, EntitlementType> = {
  covered: "informational",
  unlimited: "unlimited",
  ppm: "visits",
  fixed: "visits",
  handyman: "hours",
};

/**
 * Which services are call-outs, and of which kind. Copied onto each
 * entitlement at activation, so a later change here never alters a signed
 * contract. Keyed by the catalogue's service ids.
 */
export const CALL_OUT_CLASS_BY_SERVICE_ID: Record<string, CallOutClass> = {
  emergency: "emergency",
  "non-emergency": "non_emergency",
};

/**
 * BUSINESS DECISION REQUIRED: whether a visit/hour allowance scales with
 * the units on the row (e.g. 3 AC units x 4 visits = 12 visits, or 4 visits
 * that cover all 3 units). Until decided, the allowance is the frequency
 * (visits or hours a year) and the units are kept alongside it.
 */
export function includedQuantityFor(
  type: EntitlementType,
  units: number,
  frequency: number,
): number | null {
  void units;
  if (type === "visits" || type === "hours") return frequency;
  return null;
}

/** Contract length when nothing else is given (the documents say one year). */
export const DEFAULT_TERM_MONTHS = 12;

/**
 * Days before the end date from which a running contract reads
 * "expiring". BUSINESS DECISION REQUIRED for the real figure; 30 is the
 * neutral default and every helper takes an override.
 */
export const DEFAULT_EXPIRING_WINDOW_DAYS = 30;

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses yyyy-MM-dd as a calendar date (UTC midnight), or null. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today in Dubai as yyyy-MM-dd (contracts are local-date based). */
export function todayInDubai(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** start + months, the same way the proposal's default end date is made. */
export function addMonths(isoDate: string, months: number): string | null {
  const date = parseDate(isoDate);
  if (!date) return null;
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return formatIsoDate(target);
}

export function defaultEndDate(startDate: string, termMonths = DEFAULT_TERM_MONTHS): string | null {
  return addMonths(startDate, termMonths);
}

export type PeriodCheck = { ok: true } | { ok: false; error: string };

export function validatePeriod(startDate: string, endDate: string): PeriodCheck {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start) return { ok: false, error: "Enter a valid start date." };
  if (!end) return { ok: false, error: "Enter a valid end date." };
  if (end.getTime() <= start.getTime()) {
    return { ok: false, error: "The end date must be after the start date." };
  }
  if (end.getTime() - start.getTime() > 10 * 366 * 86_400_000) {
    return { ok: false, error: "A contract cannot run for more than ten years." };
  }
  return { ok: true };
}

/** Whole calendar days from `today` to the end date (0 on the last day, negative after). */
export function daysRemaining(endDate: string, today: string = todayInDubai()): number | null {
  const end = parseDate(endDate);
  const now = parseDate(today);
  if (!end || !now) return null;
  return Math.round((end.getTime() - now.getTime()) / 86_400_000);
}

export function isExpired(endDate: string, today: string = todayInDubai()): boolean {
  const days = daysRemaining(endDate, today);
  return days !== null && days < 0;
}

export function isExpiringSoon(
  endDate: string,
  today: string = todayInDubai(),
  windowDays: number = DEFAULT_EXPIRING_WINDOW_DAYS,
): boolean {
  const days = daysRemaining(endDate, today);
  return days !== null && days >= 0 && days <= windowDays;
}

/** Contract term in whole months, for display ("12 months"). */
/** A calendar date moved by whole days (negative goes back). */
export function shiftDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The Dubai calendar date of a usage entry: a plain date is taken as is; a
 * timestamp is read in Dubai time, so 22:30 UTC counts as the next day.
 */
export function usageDate(occurredAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) return occurredAt;
  const at = new Date(occurredAt);
  return Number.isNaN(at.getTime()) ? occurredAt.slice(0, 10) : todayInDubai(at);
}

export function termMonthsBetween(startDate: string, endDate: string): number | null {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return null;
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) -
    (end.getUTCDate() < start.getUTCDate() ? 1 : 0)
  );
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export function contractDisplayStatus(
  contract: Pick<ContractForRules, "status" | "startDate" | "endDate">,
  today: string = todayInDubai(),
  windowDays: number = DEFAULT_EXPIRING_WINDOW_DAYS,
): Exclude<ContractDisplayStatus, "pending_activation"> {
  if (contract.status === "cancelled") return "cancelled";
  if (isExpired(contract.endDate, today)) return "expired";
  const start = parseDate(contract.startDate);
  const now = parseDate(today);
  if (start && now && start.getTime() > now.getTime()) return "not_started";
  if (isExpiringSoon(contract.endDate, today, windowDays)) return "expiring";
  return "active";
}

/** Whether the contract covers work on `date` (inclusive of both ends). */
export function isInForce(
  contract: Pick<ContractForRules, "status" | "startDate" | "endDate">,
  date: string,
): boolean {
  if (contract.status !== "active") return false;
  const d = parseDate(date);
  const start = parseDate(contract.startDate);
  const end = parseDate(contract.endDate);
  if (!d || !start || !end) return false;
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

export type TransitionCheck = { ok: true } | { ok: false; status: 409; error: string };

export function canCancelContract(status: StoredContractStatus): TransitionCheck {
  return status === "active"
    ? { ok: true }
    : { ok: false, status: 409, error: "Only an active contract can be cancelled." };
}

/* ------------------------------------------------------------------ */
/* Activation                                                          */
/* ------------------------------------------------------------------ */

export type ActivationCheck = { ok: true } | { ok: false; status: 400 | 409; error: string };

/** Whether a proposal may become a contract now. */
export function checkActivation({
  submissionStatus,
  alreadyActivated,
  startDate,
  endDate,
  signedByName,
  signedAt,
}: {
  submissionStatus: string;
  alreadyActivated: boolean;
  startDate: string;
  endDate: string;
  signedByName?: string | null;
  signedAt?: string | null;
}): ActivationCheck {
  if (submissionStatus !== "signed" || !signedByName?.trim() || !signedAt) {
    return {
      ok: false,
      status: 409,
      error: "Only a proposal the client has signed can be activated.",
    };
  }
  if (alreadyActivated) {
    return { ok: false, status: 409, error: "This proposal has already been activated." };
  }
  const period = validatePeriod(startDate, endDate);
  if (!period.ok) return { ok: false, status: 400, error: period.error };
  return { ok: true };
}

export interface SignedServiceRow {
  serviceId: string;
  included: boolean;
  units: number;
  frequency: number;
  basePrice?: number | null;
  price?: number | null;
}

export interface SignedServiceDefinition {
  id: string;
  label: string;
  frequencyType: string;
}

/**
 * The entitlements a signed proposal grants: one per ticked service, typed
 * from the service's frequency type in the SIGNED settings (not today's),
 * priced as signed. A ticked row whose service the signed settings no
 * longer describe is kept as informational rather than dropped, so nothing
 * the client signed for disappears.
 */
export function deriveEntitlements(
  rows: ReadonlyArray<SignedServiceRow>,
  services: ReadonlyArray<SignedServiceDefinition>,
): ContractEntitlement[] {
  const byId = new Map(services.map((service) => [service.id, service]));
  const order = new Map(services.map((service, index) => [service.id, index]));
  return rows
    .filter((row) => row.included)
    .map((row, index) => {
      const service = byId.get(row.serviceId);
      const type = service
        ? (ENTITLEMENT_TYPE_BY_FREQUENCY_TYPE[service.frequencyType] ?? "informational")
        : "informational";
      const units = Math.max(1, Math.trunc(row.units || 1));
      const frequency = Math.max(1, Math.trunc(row.frequency || 1));
      return {
        serviceId: row.serviceId,
        serviceLabel: (service?.label ?? row.serviceId).replace(/\s*\(.*?\)\s*/g, " ").trim(),
        entitlementType: type,
        callOutClass: CALL_OUT_CLASS_BY_SERVICE_ID[row.serviceId] ?? null,
        units,
        frequency,
        includedQuantity: includedQuantityFor(type, units, frequency),
        usedQuantity: 0,
        basePrice: row.basePrice === undefined || row.basePrice === null ? null : roundAed(row.basePrice),
        contractedPrice: roundAed(Number(row.price ?? 0)),
        frequencyType: service?.frequencyType ?? null,
        sortOrder: order.get(row.serviceId) ?? 1000 + index,
      };
    });
}

/* ------------------------------------------------------------------ */
/* Entitlements and usage                                              */
/* ------------------------------------------------------------------ */

/** What is left, or null where "left" has no meaning (unlimited, informational). */
export function remainingQuantity(
  e: Pick<ContractEntitlement, "entitlementType" | "includedQuantity" | "usedQuantity">,
): number | null {
  if (e.entitlementType !== "visits" && e.entitlementType !== "hours") return null;
  const included = e.includedQuantity ?? 0;
  return Math.max(0, roundQuantity(included - e.usedQuantity));
}

export function isConsumable(e: Pick<ContractEntitlement, "entitlementType">): boolean {
  return e.entitlementType !== "informational";
}

export function isExhausted(
  e: Pick<ContractEntitlement, "entitlementType" | "includedQuantity" | "usedQuantity">,
): boolean {
  const left = remainingQuantity(e);
  return left !== null && left <= 0;
}

/** Share of the allowance used, 0-100, or null when there is no allowance. */
export function usagePercent(
  e: Pick<ContractEntitlement, "entitlementType" | "includedQuantity" | "usedQuantity">,
): number | null {
  if (e.entitlementType !== "visits" && e.entitlementType !== "hours") return null;
  const included = e.includedQuantity ?? 0;
  if (included <= 0) return 100;
  return Math.min(100, Math.round((e.usedQuantity / included) * 100));
}

export function unitWord(type: EntitlementType, quantity: number): string {
  if (type === "hours") return quantity === 1 ? "hour" : "hours";
  if (type === "visits") return quantity === 1 ? "visit" : "visits";
  return "";
}

/** "1 of 4 visits used", "2.5 of 6 hours used", "3 used (unlimited)", "Included". */
export function describeUsage(
  e: Pick<ContractEntitlement, "entitlementType" | "includedQuantity" | "usedQuantity">,
): string {
  switch (e.entitlementType) {
    case "visits":
    case "hours": {
      const included = e.includedQuantity ?? 0;
      return `${formatQuantity(e.usedQuantity)} of ${formatQuantity(included)} ${unitWord(
        e.entitlementType,
        included,
      )} used`;
    }
    case "unlimited":
      return `${formatQuantity(e.usedQuantity)} used (unlimited)`;
    default:
      return "Included";
  }
}

export function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, "");
}

function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100;
}

export type UsageCheck = { ok: true; quantity: number } | { ok: false; status: 400 | 409; error: string };

/**
 * Whether a usage entry may be recorded. The database enforces the same
 * limits (CHECKs and the ledger trigger); this gives a readable answer
 * first.
 */
export function checkUsage({
  contract,
  entitlement,
  kind,
  quantity,
  occurredAt,
  notes,
}: {
  contract: Pick<ContractForRules, "status" | "startDate" | "endDate">;
  entitlement: Pick<ContractEntitlement, "entitlementType" | "includedQuantity" | "usedQuantity">;
  kind: "consumption" | "adjustment";
  quantity: number;
  occurredAt: string; // ISO timestamp or yyyy-MM-dd
  notes?: string | null;
}): UsageCheck {
  if (!Number.isFinite(quantity) || quantity === 0) {
    return { ok: false, status: 400, error: "Enter a quantity." };
  }
  const q = roundQuantity(quantity);
  if (Math.abs(q - quantity) > 1e-9) {
    return { ok: false, status: 400, error: "Use at most two decimals." };
  }
  if (entitlement.entitlementType === "informational") {
    return { ok: false, status: 409, error: "This service is informational and is not consumed." };
  }
  if (entitlement.entitlementType === "visits" && !Number.isInteger(q)) {
    return { ok: false, status: 400, error: "Visits are counted in whole numbers." };
  }
  if (kind === "consumption") {
    if (q < 0) return { ok: false, status: 400, error: "Usage must be a positive quantity." };
    if (contract.status !== "active") {
      return { ok: false, status: 409, error: "Usage can only be recorded on an active contract." };
    }
    const date = usageDate(occurredAt);
    if (!isInForce(contract, date)) {
      return {
        ok: false,
        status: 409,
        error: "That date is outside the contract period.",
      };
    }
  } else if (!notes || !notes.trim()) {
    return { ok: false, status: 400, error: "An adjustment needs a reason." };
  }
  const after = roundQuantity(entitlement.usedQuantity + q);
  if (after < 0) {
    return { ok: false, status: 409, error: "That would take usage below zero." };
  }
  const included = entitlement.includedQuantity;
  if (
    (entitlement.entitlementType === "visits" || entitlement.entitlementType === "hours") &&
    included !== null &&
    after > included
  ) {
    const left = remainingQuantity(entitlement) ?? 0;
    return {
      ok: false,
      status: 409,
      error: `Only ${formatQuantity(left)} ${unitWord(entitlement.entitlementType, left)} left on this service.`,
    };
  }
  return { ok: true, quantity: q };
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

export type CoverageOutcome =
  /* covered by an allowance with something left, or unlimited */
  | "covered"
  /* contract in force, service on it, allowance used up: chargeable */
  | "exhausted"
  /* contract in force, service on it but informational only */
  | "informational"
  /* contract in force, service not on it: chargeable */
  | "not_covered"
  /* no contract in force on that date */
  | "no_contract";

/** Where the customer's AMC stands on the requested date. */
export type AmcCoverageStatus = "active" | "not_started" | "expired" | "cancelled" | "none";

export interface CoverageResult {
  outcome: CoverageOutcome;
  amcStatus: AmcCoverageStatus;
  /** Would the request be free under the AMC? */
  covered: boolean;
  chargeable: boolean;
  contractId: string | null;
  entitlementType: EntitlementType | null;
  callOutClass: CallOutClass | null;
  included: number | null;
  used: number | null;
  remaining: number | null;
  unlimited: boolean;
  reason: string;
}

/**
 * Given the contracts for a customer/property, a service and a date: is
 * there an AMC in force, is the service on it, and would this request be
 * covered or chargeable? Future scheduling/FSM flows call this.
 */
export function checkCoverage(
  contracts: ReadonlyArray<ContractForRules>,
  { serviceId, date }: { serviceId: string; date: string },
): CoverageResult {
  const base = {
    contractId: null,
    entitlementType: null,
    callOutClass: null,
    included: null,
    used: null,
    remaining: null,
    unlimited: false,
  };
  const inForce = contracts
    .filter((c) => isInForce(c, date))
    /* The most recent start wins when renewals overlap. */
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const contract = inForce[0];
  if (!contract) {
    /* Why there is none: a contract that has not started, has ended, or
       was cancelled reads differently from no contract at all. */
    const d = parseDate(date)?.getTime() ?? 0;
    const covering = (c: ContractForRules) => {
      const s = parseDate(c.startDate)?.getTime() ?? 0;
      const e = parseDate(c.endDate)?.getTime() ?? 0;
      return d >= s && d <= e;
    };
    const amcStatus: AmcCoverageStatus = contracts.some((c) => c.status === "cancelled" && covering(c))
      ? "cancelled"
      : contracts.some((c) => c.status === "active" && (parseDate(c.startDate)?.getTime() ?? 0) > d)
        ? "not_started"
        : contracts.some((c) => c.status === "active" && (parseDate(c.endDate)?.getTime() ?? 0) < d)
          ? "expired"
          : "none";
    const reasons: Record<AmcCoverageStatus, string> = {
      cancelled: "The AMC was cancelled.",
      not_started: "The AMC has not started on that date.",
      expired: "The AMC had expired by that date.",
      none: "No AMC is in force on that date.",
      active: "",
    };
    return {
      ...base,
      amcStatus,
      outcome: "no_contract",
      covered: false,
      chargeable: true,
      reason: reasons[amcStatus],
    };
  }
  const e = contract.entitlements.find((item) => item.serviceId === serviceId);
  if (!e) {
    return {
      ...base,
      amcStatus: "active",
      contractId: contract.id ?? null,
      outcome: "not_covered",
      covered: false,
      chargeable: true,
      reason: "The AMC does not include this service.",
    };
  }
  const shared = {
    amcStatus: "active" as const,
    contractId: contract.id ?? null,
    entitlementType: e.entitlementType,
    callOutClass: e.callOutClass,
    included: e.includedQuantity,
    used: e.usedQuantity,
    remaining: remainingQuantity(e),
    unlimited: e.entitlementType === "unlimited",
  };
  if (e.entitlementType === "informational") {
    return {
      ...shared,
      outcome: "informational",
      covered: true,
      chargeable: false,
      reason: "Included in the AMC; not counted against an allowance.",
    };
  }
  if (e.entitlementType === "unlimited") {
    return { ...shared, outcome: "covered", covered: true, chargeable: false, reason: "Covered (unlimited)." };
  }
  if (isExhausted(e)) {
    return {
      ...shared,
      outcome: "exhausted",
      covered: false,
      chargeable: true,
      reason: "The allowance for this service is used up.",
    };
  }
  return {
    ...shared,
    outcome: "covered",
    covered: true,
    chargeable: false,
    reason: `Covered: ${formatQuantity(shared.remaining ?? 0)} ${unitWord(e.entitlementType, shared.remaining ?? 0)} left.`,
  };
}

/* ------------------------------------------------------------------ */
/* Commercial snapshot                                                 */
/* ------------------------------------------------------------------ */

/** True when two AED amounts agree to the fil (or within `slackFils`). */
export function sameAmount(a: number, b: number, slackFils = 0): boolean {
  return Math.abs(toFils(a) - toFils(b)) <= slackFils;
}

/* ------------------------------------------------------------------ */
/* Operations: states, summaries, previews, corrections, labels        */
/* ------------------------------------------------------------------ */

/**
 * Days before the end date from which a contract reads "expiring".
 * Configuration default, NOT an approved business rule (same value as
 * DEFAULT_EXPIRING_WINDOW_DAYS; every helper takes an override).
 */
export const EXPIRING_SOON_DAYS = DEFAULT_EXPIRING_WINDOW_DAYS;

/**
 * An allowance reads "low" when at most this share of it is left (and
 * something is left). Configuration default, not a business rule.
 */
export const LOW_REMAINING_FRACTION = 0.25;

export type EntitlementState =
  | "available"
  | "low_remaining"
  | "exhausted"
  | "unlimited"
  | "included"
  | "not_started"
  | "expired"
  | "cancelled";

/** The state a service is in today, given its contract's state. */
export function entitlementState(
  e: Pick<ContractEntitlement, "entitlementType" | "includedQuantity" | "usedQuantity">,
  contractStatus: Exclude<ContractDisplayStatus, "pending_activation">,
): EntitlementState {
  if (contractStatus === "cancelled") return "cancelled";
  if (contractStatus === "expired") return "expired";
  if (contractStatus === "not_started") return "not_started";
  if (e.entitlementType === "informational") return "included";
  if (e.entitlementType === "unlimited") return "unlimited";
  const left = remainingQuantity(e) ?? 0;
  const included = e.includedQuantity ?? 0;
  if (left <= 0) return "exhausted";
  if (included > 0 && left / included <= LOW_REMAINING_FRACTION) return "low_remaining";
  return "available";
}

export interface ContractSummary {
  totalServices: number;
  /** Visit or hour allowances with something left. */
  withRemaining: number;
  exhausted: number;
  unlimited: number;
  informational: number;
  /** Kept per unit: visits and hours are never added together. */
  remainingVisits: number;
  includedVisits: number;
  remainingHours: number;
  includedHours: number;
  usageEvents: number;
  lastUsageDate: string | null;
}

export function summarizeContract(
  entitlements: ReadonlyArray<Pick<ContractEntitlement, "entitlementType" | "includedQuantity" | "usedQuantity">>,
  usage: ReadonlyArray<{ kind: string; occurredAt: string }> = [],
): ContractSummary {
  const counted = entitlements.filter((e) => e.entitlementType === "visits" || e.entitlementType === "hours");
  const sum = (type: EntitlementType, pick: "remaining" | "included") =>
    roundQuantity(
      entitlements
        .filter((e) => e.entitlementType === type)
        .reduce(
          (total, e) => total + (pick === "remaining" ? (remainingQuantity(e) ?? 0) : (e.includedQuantity ?? 0)),
          0,
        ),
    );
  const consumptions = usage.filter((u) => u.kind === "consumption");
  const last = consumptions.reduce<string | null>(
    (latest, u) => (!latest || u.occurredAt > latest ? u.occurredAt : latest),
    null,
  );
  return {
    totalServices: entitlements.length,
    withRemaining: counted.filter((e) => (remainingQuantity(e) ?? 0) > 0).length,
    exhausted: counted.filter((e) => isExhausted(e)).length,
    unlimited: entitlements.filter((e) => e.entitlementType === "unlimited").length,
    informational: entitlements.filter((e) => e.entitlementType === "informational").length,
    remainingVisits: sum("visits", "remaining"),
    includedVisits: sum("visits", "included"),
    remainingHours: sum("hours", "remaining"),
    includedHours: sum("hours", "included"),
    usageEvents: usage.length,
    lastUsageDate: last,
  };
}

export interface UsagePreview {
  unit: string;
  unlimited: boolean;
  included: number | null;
  used: number;
  recording: number;
  /** null when unlimited. */
  remainingAfter: number | null;
}

/** What the form shows before submitting: included, used, recording, left after. */
export function usagePreview(
  e: Pick<ContractEntitlement, "entitlementType" | "includedQuantity" | "usedQuantity">,
  quantity: number,
): UsagePreview {
  const recording = Number.isFinite(quantity) ? roundQuantity(quantity) : 0;
  const unlimited = e.entitlementType === "unlimited";
  return {
    unit: e.entitlementType === "hours" ? "hours" : e.entitlementType === "visits" ? "visits" : "call-outs",
    unlimited,
    included: e.includedQuantity,
    used: e.usedQuantity,
    recording,
    remainingAfter: unlimited ? null : roundQuantity((e.includedQuantity ?? 0) - e.usedQuantity - recording),
  };
}

export type CorrectionCheck = { ok: true; quantity: number } | { ok: false; status: 400 | 409; error: string };

/**
 * A correction takes back (part of) one consumption entry. `amount` is the
 * positive quantity to take back; the ledger stores it as a negative
 * correction that references the original.
 */
export function checkCorrection({
  original,
  alreadyCorrected,
  amount,
  reason,
  entitlementUsed,
}: {
  original: { kind: string; quantity: number };
  /** Sum of earlier corrections of this entry (negative or zero). */
  alreadyCorrected: number;
  amount: number;
  reason: string | null | undefined;
  /** The service's current used quantity. */
  entitlementUsed: number;
}): CorrectionCheck {
  if (original.kind !== "consumption") {
    return { ok: false, status: 409, error: "Only a usage entry can be corrected." };
  }
  if (!reason || reason.trim().length < 3) {
    return { ok: false, status: 400, error: "A correction needs a reason." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: 400, error: "Enter the quantity to take back." };
  }
  const q = roundQuantity(amount);
  if (Math.abs(q - amount) > 1e-9) return { ok: false, status: 400, error: "Use at most two decimals." };
  const left = roundQuantity(original.quantity + alreadyCorrected);
  if (left <= 0) return { ok: false, status: 409, error: "This entry has already been fully corrected." };
  if (q > left) {
    return {
      ok: false,
      status: 409,
      error: `Only ${formatQuantity(left)} of this entry can still be taken back.`,
    };
  }
  if (roundQuantity(entitlementUsed - q) < 0) {
    return { ok: false, status: 409, error: "That would take usage below zero." };
  }
  return { ok: true, quantity: -q };
}

/** "Expires in 24 days", "Expires today", "Expired 12 days ago", "Starts in 5 days". */
export function expiryLabel(
  contract: Pick<ContractForRules, "status" | "startDate" | "endDate">,
  today: string = todayInDubai(),
): string {
  if (contract.status === "cancelled") return "Cancelled";
  const start = parseDate(contract.startDate);
  const now = parseDate(today);
  if (start && now && start.getTime() > now.getTime()) {
    const days = Math.round((start.getTime() - now.getTime()) / 86_400_000);
    return days === 1 ? "Starts tomorrow" : `Starts in ${days} days`;
  }
  const days = daysRemaining(contract.endDate, today);
  if (days === null) return "—";
  if (days > 1) return `Expires in ${days} days`;
  if (days === 1) return "Expires tomorrow";
  if (days === 0) return "Expires today";
  if (days === -1) return "Expired yesterday";
  return `Expired ${Math.abs(days)} days ago`;
}

export type CoverageVerdict = "covered_by_amc" | "chargeable" | "no_active_amc";

/** The staff-facing answer of the coverage check, in plain words. */
export function coverageVerdict(
  result: CoverageResult,
  serviceLabel: string,
): { verdict: CoverageVerdict; headline: string; details: string[] } {
  if (result.outcome === "no_contract") {
    return { verdict: "no_active_amc", headline: "No active AMC", details: [result.reason] };
  }
  if (result.outcome === "not_covered") {
    return { verdict: "chargeable", headline: "Chargeable", details: [`${serviceLabel} is not part of this AMC.`] };
  }
  const usage =
    result.entitlementType === "visits" || result.entitlementType === "hours"
      ? `${formatQuantity(result.used ?? 0)} of ${formatQuantity(result.included ?? 0)} ${unitWord(
          result.entitlementType,
          result.included ?? 0,
        )} used`
      : result.entitlementType === "unlimited"
        ? `${formatQuantity(result.used ?? 0)} used so far (unlimited)`
        : "Included in the AMC (not counted)";
  if (result.outcome === "exhausted") {
    return {
      verdict: "chargeable",
      headline: "Chargeable: allowance used up",
      details: [serviceLabel, usage, "0 remaining"],
    };
  }
  const left =
    result.remaining !== null && result.entitlementType
      ? `${formatQuantity(result.remaining)} ${unitWord(result.entitlementType, result.remaining)} remaining`
      : result.unlimited
        ? "Remaining: unlimited"
        : null;
  return {
    verdict: "covered_by_amc",
    headline: "Covered by AMC",
    details: [serviceLabel, usage, ...(left ? [left] : [])],
  };
}

/**
 * The commercial figures a contract takes from its signed proposal. The
 * stored figures are what the client was quoted, so they win: the final
 * price and discount come from the proposal, and the subtotal is final +
 * discount. Each line is re-priced from its base price; a legacy line that
 * stored only its price keeps that price (a missing base price would
 * otherwise read as 0).
 */
export function signedCommercials(
  rows: ReadonlyArray<{
    serviceId: string;
    included: boolean;
    units: number;
    frequency: number;
    basePrice?: number | null;
    price?: number | null;
  }>,
  stored: { discountPercent?: number | null; discountAmount?: number | null; finalPrice?: number | null },
): {
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  finalPrice: number;
  linePrices: Map<string, number>;
} {
  const pricing = computeAmcPricing(rows, Number(stored.discountPercent ?? 0));
  const finalPrice = roundAed(Number(stored.finalPrice ?? pricing.finalPrice));
  const discountAmount = roundAed(Number(stored.discountAmount ?? pricing.discountAmount));
  const linePrices = new Map<string, number>();
  for (const row of rows) {
    const legacy = row.basePrice === undefined || row.basePrice === null;
    linePrices.set(
      row.serviceId,
      legacy
        ? roundAed(Number(row.price ?? 0))
        : (pricing.rows.find((p) => p.serviceId === row.serviceId)?.price ?? 0),
    );
  }
  return {
    subtotal: filsToAed(toFils(finalPrice) + toFils(discountAmount)),
    discountPercent: Number(stored.discountPercent ?? pricing.discountPercent),
    discountAmount,
    finalPrice,
    linePrices,
  };
}
