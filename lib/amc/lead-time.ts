/*
  The property's access lead time (DEV-493, 20 Nov 2026): a gate pass or
  work permit needs N days' notice (amc_property_access_rules.lead_time_days).
  A PPM visit, call out or site visit booked closer than that is warned
  about before it is saved, instead of relying on the one global "access
  not ready two days before" alert. Booking anyway is allowed and recorded.
*/

/** Starts the API's 409 message, so the screens know to ask "book anyway?". */
export const LEAD_TIME_MARK = "Inside the access lead time";

export interface LeadTimeRule {
  accessType: string;
  issuer?: string | null;
  leadTimeDays: number | null;
}

export interface LeadTimeShortfall {
  /** "Community gate pass (Emaar)". */
  rule: string;
  leadTimeDays: number;
  /** Whole days from today to the booked day. */
  daysNotice: number;
}

const ruleLabel = (r: LeadTimeRule) => {
  const type = r.accessType.replace(/_/g, " ");
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}${r.issuer ? ` (${r.issuer})` : ""}`;
};

/** The rule most short of its notice for a booking on `day`, or null when every rule has enough. */
export function leadTimeShortfall(rules: LeadTimeRule[], day: string, today: string): LeadTimeShortfall | null {
  const daysNotice = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(daysNotice)) return null;
  let worst: LeadTimeShortfall | null = null;
  for (const r of rules) {
    const need = Number(r.leadTimeDays ?? 0);
    if (need > 0 && daysNotice < need && (!worst || need - daysNotice > worst.leadTimeDays - worst.daysNotice)) {
      worst = { rule: ruleLabel(r), leadTimeDays: need, daysNotice: Math.max(0, daysNotice) };
    }
  }
  return worst;
}

export function leadTimeMessage(s: LeadTimeShortfall): string {
  const notice = s.daysNotice === 0 ? "today" : s.daysNotice === 1 ? "tomorrow" : `in ${s.daysNotice} days`;
  return `${LEAD_TIME_MARK}: ${s.rule} needs ${s.leadTimeDays} day${s.leadTimeDays === 1 ? "" : "s"}' notice and this booking is ${notice}. The pass may not be ready.`;
}

export const isLeadTimeWarning = (message: string | null | undefined) => Boolean(message?.startsWith(LEAD_TIME_MARK));

/** The most notice any of the rules needs: the access alert's distance for that property (0 = none). */
export const longestLeadTime = (rules: LeadTimeRule[]) => rules.reduce((max, r) => Math.max(max, Number(r.leadTimeDays ?? 0)), 0);
