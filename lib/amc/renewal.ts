/**
 * Renewing an AMC.
 *
 *   Active contract -> renewal proposal (a normal draft, pre-filled) ->
 *   the usual approval, client approval and signature -> activation ->
 *   a NEW contract whose renewed_from_contract_id points back.
 *
 * The old contract is never edited or extended. Nothing is sent
 * automatically. The draft uses the CURRENT settings catalogue (services
 * no longer offered are left out and reported) and goes through the
 * server's current pricing when it is saved.
 *
 * BUSINESS DECISION REQUIRED: base prices are entered per proposal (there
 * is no price list), so the draft starts from the expiring contract's base
 * prices for the team to review. Whether renewals should start from a
 * standard rate card instead is open.
 */
import { addMonths, shiftDays, termMonthsBetween, type ContractEntitlement } from "./contracts";

export interface RenewalSource {
  id: string;
  startDate: string;
  endDate: string;
  customer: Record<string, unknown>;
  property: Record<string, unknown>;
  accountManagers: ReadonlyArray<{ name?: string; phone?: string }>;
  discountPercent: number;
  entitlements: ReadonlyArray<ContractEntitlement>;
}

export interface RenewalDraft {
  property: Record<string, unknown>;
  customer: Record<string, unknown>;
  accountManagers: Array<{ name: string; phone: string }>;
  services: Array<{
    serviceId: string;
    included: boolean;
    units: number;
    frequency: number;
    basePrice: number | null;
  }>;
  discountPercent: number;
  /** Contracted services the current catalogue no longer offers. */
  droppedServiceIds: string[];
}

/**
 * Pre-fills a renewal proposal. `offeredServiceIds` is the current AMC
 * Settings catalogue for the property type.
 */
export function buildRenewalDraft(
  source: RenewalSource,
  offeredServiceIds: ReadonlyArray<string>,
): RenewalDraft {
  const offered = new Set(offeredServiceIds);
  const term = Math.max(1, termMonthsBetween(source.startDate, source.endDate) ?? 12);
  /* The day after the old contract ends: both ends of a period are
     covered, so starting on the end date would overlap by a day. The new
     period runs the same number of months, by the same convention as
     activation (defaultEndDate: 2 Oct 2027 to 2 Oct 2028). */
  const startDate = shiftDays(source.endDate, 1);
  const endDate = addMonths(startDate, term) ?? "";

  const services = source.entitlements
    .filter((e) => offered.has(e.serviceId))
    .map((e) => ({
      serviceId: e.serviceId,
      included: true,
      units: e.units,
      frequency: e.frequency,
      basePrice: e.basePrice,
    }));
  const droppedServiceIds = source.entitlements
    .filter((e) => !offered.has(e.serviceId))
    .map((e) => e.serviceId);

  const managers = [...source.accountManagers].slice(0, 2).map((m) => ({
    name: String(m?.name ?? ""),
    phone: String(m?.phone ?? ""),
  }));
  while (managers.length < 2) managers.push({ name: "", phone: "" });

  return {
    property: { ...source.property },
    customer: {
      ...source.customer,
      startDate,
      endDate,
      /* A new proposal gets its own number from the database. */
      proposalNumber: "",
    },
    accountManagers: managers,
    services,
    discountPercent: source.discountPercent,
    droppedServiceIds,
  };
}

/**
 * Why a renewal proposal cannot be started, or null when it can. One
 * renewal proposal per contract (the database enforces it too).
 */
export function renewalBlockedReason(contract: {
  status: "active" | "cancelled";
  renewedByContractId: string | null;
  hasRenewalProposal: boolean;
}): string | null {
  if (contract.status === "cancelled") return "A cancelled contract cannot be renewed.";
  if (contract.renewedByContractId) return "This contract has already been renewed.";
  if (contract.hasRenewalProposal) return "A renewal proposal already exists for this contract.";
  return null;
}

/* ------------------------------------------------------------------ */
/* Renewal reminders                                                   */
/* ------------------------------------------------------------------ */

/**
 * Days before the end date to remind the team: configuration DEFAULTS,
 * not an approved business schedule (BUSINESS DECISION REQUIRED).
 */
export const AMC_RENEWAL_REMINDER_DAYS: ReadonlyArray<number> = [60, 30, 15];

/**
 * Master switch. Off: reminders are only previewed, never created, so no
 * production reminder email can be sent by accident. Turn on (with the
 * approved thresholds) when the schedule is agreed.
 */
export const AMC_RENEWAL_REMINDERS_ENABLED = false;

/**
 * The reminder dates still ahead for a contract ending on `endDate`,
 * earliest first. The reminders themselves would be Todos (the existing
 * reminders cron emails them); see the implementation report.
 */
/** The planned reminders not already created for this contract. */
export function newReminders(
  planned: ReadonlyArray<{ daysBefore: number; remindOn: string }>,
  existingThresholds: ReadonlyArray<number>,
): Array<{ daysBefore: number; remindOn: string }> {
  const existing = new Set(existingThresholds);
  return planned.filter((reminder) => !existing.has(reminder.daysBefore));
}

export function planRenewalReminders(
  endDate: string,
  today: string,
  thresholds: ReadonlyArray<number> = AMC_RENEWAL_REMINDER_DAYS,
): Array<{ daysBefore: number; remindOn: string }> {
  return [...new Set(thresholds)]
    .filter((days) => Number.isInteger(days) && days > 0)
    .map((daysBefore) => {
      const end = new Date(`${endDate}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() - daysBefore);
      return { daysBefore, remindOn: end.toISOString().slice(0, 10) };
    })
    .filter((reminder) => reminder.remindOn >= today)
    .sort((a, b) => a.remindOn.localeCompare(b.remindOn));
}
