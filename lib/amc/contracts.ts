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
import { roundAed, toFils } from "./pricing";

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
    const date = occurredAt.slice(0, 10);
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

export interface CoverageResult {
  outcome: CoverageOutcome;
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
    return {
      ...base,
      outcome: "no_contract",
      covered: false,
      chargeable: true,
      reason: "No AMC is in force on that date.",
    };
  }
  const e = contract.entitlements.find((item) => item.serviceId === serviceId);
  if (!e) {
    return {
      ...base,
      contractId: contract.id ?? null,
      outcome: "not_covered",
      covered: false,
      chargeable: true,
      reason: "The AMC does not include this service.",
    };
  }
  const shared = {
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
