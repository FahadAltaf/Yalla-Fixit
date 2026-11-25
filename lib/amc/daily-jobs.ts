/*
  What the AMC daily job does when the scheduler calls it (DEV-485, 23 Nov
  2026). Each part can be switched on in AMC configuration -> Daily jobs.
  The first release runs only what Jira names: expiry notices (contracts
  past their end marked expired, the 60 and 30 day notices) and the PPM
  confirmation reminders. Client emails are a separate switch, off: while
  off, no daily job emails a client, scheduled or Run now.
*/

export const DAILY_JOB_PARTS = [
  "expiry_status",
  "expiry_notices",
  "ppm_confirmations",
  "renewal_follow_up",
  "todo_escalations",
  "enquiry_follow_ups",
  "enquiry_idle",
  "proposal_validity",
  "unsigned_contracts",
  "payments",
  "ppm_overdue",
  "access_alerts",
  "crew_reminders",
  "visit_reminders",
  "job_sheets",
  "call_outs",
  "expiry_reminders",
] as const;
export type DailyJobPart = (typeof DAILY_JOB_PARTS)[number];

export const DAILY_JOB_PART_LABELS: Record<DailyJobPart, string> = {
  expiry_status: "Mark contracts past their end date as expired",
  expiry_notices: "Expiry notices to the owner, 60 and 30 days before the end",
  ppm_confirmations: "PPM confirmation to-dos, and the daily reminder until the client confirms",
  renewal_follow_up: "Renewal to-dos and escalation, renewed and lapsed outcomes, scheduled terminations",
  todo_escalations: "Escalate overdue AMC to-dos",
  enquiry_follow_ups: "Tell owners about enquiry follow-ups that are due",
  enquiry_idle: "Flag idle enquiries, then escalate them to management",
  proposal_validity: "Tell owners when a proposal with the client is about to lapse",
  unsigned_contracts: "Unsigned contracts: the follow-up to-do, and the client reminder (a client email)",
  payments: "Instalments due and overdue, cheque dates, late first payments (client reminders are client emails)",
  ppm_overdue: "Tell owners about PPM visits past their window",
  access_alerts: "Alert the owner when a visit is near without a usable pass",
  crew_reminders: "The technician's reminder in the YFI app on the day of the visit",
  visit_reminders: "The client's reminder the day before a visit (a client email)",
  job_sheets: "Job sheets not submitted, and service reports at risk of being late",
  call_outs: "Call outs with the SLA at risk or missed",
  expiry_reminders: "Contract expiry reminders to the client (a client email; also needs Send automatically)",
};

/** DEV-485 first release: only what Jira names. */
export const FIRST_RELEASE_PARTS: DailyJobPart[] = ["expiry_status", "expiry_notices", "ppm_confirmations"];

/** The parts that can email a client: held while client emails are off. */
export const CLIENT_EMAIL_PARTS: DailyJobPart[] = ["unsigned_contracts", "payments", "visit_reminders", "expiry_reminders"];

/** Which daily job a part belongs to (lib/server/amc/jobs.ts keys). */
export const PART_JOB: Record<DailyJobPart, string> = {
  expiry_status: "contract_expiry_status",
  expiry_notices: "renewals",
  renewal_follow_up: "renewals",
  ppm_confirmations: "visits",
  access_alerts: "visits",
  crew_reminders: "visits",
  visit_reminders: "visits",
  todo_escalations: "todo_escalations",
  enquiry_follow_ups: "enquiry_follow_ups",
  enquiry_idle: "enquiry_idle",
  proposal_validity: "proposal_validity",
  unsigned_contracts: "unsigned_contracts",
  payments: "payments",
  ppm_overdue: "ppm_overdue",
  job_sheets: "job_sheets",
  call_outs: "call_outs",
  expiry_reminders: "expiry_reminders",
};

/** The jobs a scheduled run starts, from the parts switched on. */
export function scheduledJobs(parts: readonly DailyJobPart[]): string[] {
  return [...new Set(parts.map((p) => PART_JOB[p]))];
}

/** The visit sweep's parts: all of them for Run now, the ones switched on for the scheduler. */
export function visitParts(parts: readonly DailyJobPart[] | null) {
  const on = (p: DailyJobPart) => !parts || parts.includes(p);
  return { confirmations: on("ppm_confirmations"), accessAlerts: on("access_alerts"), crewReminders: on("crew_reminders"), clientReminders: on("visit_reminders") };
}

/** The renewal sweep's parts. */
export function renewalParts(parts: readonly DailyJobPart[] | null) {
  const on = (p: DailyJobPart) => !parts || parts.includes(p);
  return { notices: on("expiry_notices"), followUp: on("renewal_follow_up") };
}
