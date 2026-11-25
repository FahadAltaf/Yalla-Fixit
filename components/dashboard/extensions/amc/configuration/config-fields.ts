import { DAILY_JOB_PARTS, DAILY_JOB_PART_LABELS } from "@/lib/amc/daily-jobs";
import type { AmcConfigSection } from "@/lib/amc/config";

/**
 * How each AMC configuration section is laid out on the configuration
 * screen (DEV-419). One description per field drives one shared form, so
 * every section looks and behaves the same.
 */

/** What a person's role must allow to be named in a list (23 Nov 2026): see lib/server/amc/people.ts. */
export type PersonNeed = "amc" | "approve" | "payments" | "visits" | "contracts";

export type FieldDef =
  | { key: string; label: string; kind: "number"; unit?: string; min?: number; max?: number; step?: number; nullable?: boolean; hint?: string }
  | { key: string; label: string; kind: "text"; hint?: string }
  /* `label` sits above, as on every other field; `toggle` is the words beside the switch. */
  | { key: string; label: string; kind: "boolean"; toggle: string; hint?: string }
  | { key: string; label: string; kind: "select"; options: Array<{ value: string; label: string }>; numeric?: boolean; hint?: string }
  | { key: string; label: string; kind: "multi"; options: Array<{ value: string; label: string }>; numeric?: boolean; hint?: string; layout?: "list" }
  | { key: string; label: string; kind: "users"; hint?: string; need?: PersonNeed }
  | { key: string; label: string; kind: "list"; hint?: string }
  | { key: string; label: string; kind: "holidays"; hint?: string };

export interface SectionDef {
  section: Exclude<AmcConfigSection, "templates">;
  title: string;
  description: string;
  fields: FieldDef[];
}

const LEVELS = [
  { value: "1", label: "Level 1" },
  { value: "2", label: "Level 2" },
  { value: "3", label: "Level 3" },
];

export const PLAN_LABELS: Record<string, string> = {
  single: "Single payment",
  fifty_fifty: "50/50",
  quarterly: "Quarterly",
  monthly: "Monthly",
};
const PLANS = Object.entries(PLAN_LABELS).map(([value, label]) => ({ value, label }));

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, i) => ({
  value: String(i),
  label,
}));

export const SECTION_DEFS: SectionDef[] = [
  {
    section: "approvals",
    title: "Approval ladder",
    description:
      "Who approves proposals at each level, and what sends a proposal up a level: the discount, the value, a payment plan outside the usual ones, or a price below the floor rate. If a level names its approvers here, only they decide it. If it names nobody, the AMC approvers in Named people decide it. An approver may approve their own proposal. Changes apply to proposals submitted after you save.",
    fields: [
      { key: "level1Name", label: "Level 1 name", kind: "text" },
      { key: "level1ApproverIds", label: "Level 1 approvers", kind: "users", need: "approve" },
      { key: "level2Name", label: "Level 2 name", kind: "text" },
      { key: "level2ApproverIds", label: "Level 2 approvers", kind: "users", need: "approve" },
      { key: "level3Name", label: "Level 3 name", kind: "text" },
      { key: "level3ApproverIds", label: "Level 3 approvers", kind: "users", need: "approve", hint: "Leave empty if there is no third level." },
      {
        key: "escalationUserIds",
        label: "Escalation contacts",
        kind: "users",
        need: "amc",
        hint: "Management for escalations: an idle enquiry, an overdue to-do, a renewal nobody acts on, an overdue instalment. None named: the level 2 approvers, else level 1.",
      },
      { key: "discountLevel1AbovePercent", label: "Discount above (level 1)", kind: "number", unit: "%", min: 0, max: 100, nullable: true },
      { key: "discountLevel2AbovePercent", label: "Discount above (level 2)", kind: "number", unit: "%", min: 0, max: 100, nullable: true },
      { key: "discountLevel3AbovePercent", label: "Discount above (level 3)", kind: "number", unit: "%", min: 0, max: 100, nullable: true },
      { key: "valueLevel1AboveAed", label: "Final value above (level 1)", kind: "number", unit: "AED", min: 0, nullable: true },
      { key: "valueLevel2AboveAed", label: "Final value above (level 2)", kind: "number", unit: "AED", min: 0, nullable: true },
      { key: "valueLevel3AboveAed", label: "Final value above (level 3)", kind: "number", unit: "AED", min: 0, nullable: true },
      { key: "nonStandardPlanLevel", label: "Approval level for an unusual payment plan", kind: "select", options: LEVELS, numeric: true, hint: "Which level approves a proposal whose payment plan is custom, or is not one of the plans allowed for its value below (for example monthly payments on a small contract)." },
      { key: "belowFloorLevel", label: "Approval level for a price below the minimum", kind: "select", options: LEVELS, numeric: true, hint: "Which level approves a proposal where a service ends up below its minimum (floor) rate on the rate card, after the discount or because a lower rate was typed in." },
      { key: "escalateAfterHours", label: "Pass an undecided approval up after", kind: "number", unit: "hours", min: 1, max: 720, hint: "If nobody decides in this time, the next level's approvers are told and can decide it too. It keeps moving up, at most to level 3." },
    ],
  },
  {
    section: "payments",
    title: "Payment value bands",
    description: "Up to the amount below, a contract is paid in one go; above it, the client can choose one of the allowed plans. Any other plan needs approval.",
    fields: [
      { key: "singlePaymentBelowAed", label: "Single payment below", kind: "number", unit: "AED", min: 0 },
      { key: "plansAboveBand", label: "Plans allowed above the band", kind: "multi", options: PLANS },
      { key: "defaultPlanAboveBand", label: "Plan proposed above the band", kind: "select", options: PLANS },
      { key: "customPlanAllowed", label: "Other payment plans", kind: "boolean", toggle: "Allow another plan", hint: "Always goes for approval first." },
      { key: "lateFirstPaymentDays", label: "Alert when the first payment is late by", kind: "number", unit: "days", min: 1, max: 90 },
      { key: "chequeAlertDaysBefore", label: "Alert before a cheque date", kind: "number", unit: "days", min: 0, max: 60 },
      { key: "dueReminderDaysBefore", label: "Remind the client before an instalment is due", kind: "number", unit: "days", min: 0, max: 60 },
      { key: "financeUserIds", label: "Finance", kind: "users", need: "payments", hint: "With the contract owner, they hear about payments and get the overdue instalment to-do." },
    ],
  },
  {
    section: "enquiries",
    title: "Enquiry pipeline",
    description: "The stages, sources and lost reasons the team picks from. An enquiry left without activity is flagged to its owner, and later to management.",
    fields: [
      { key: "stages", label: "Stages (one per line, in order)", kind: "list" },
      { key: "sources", label: "Sources (one per line)", kind: "list" },
      { key: "lostReasons", label: "Lost reasons (one per line)", kind: "list" },
      { key: "idleDays", label: "Flag an idle enquiry after", kind: "number", unit: "days", min: 1, max: 90 },
      { key: "managementEscalationDays", label: "Escalate an idle enquiry to management after", kind: "number", unit: "days", min: 1, max: 180 },
    ],
  },
  {
    section: "proposals",
    title: "Proposals and site visits",
    description: "How long a proposal stays valid, and which properties need a site visit before a proposal is made.",
    fields: [
      { key: "validityDays", label: "Proposal valid for", kind: "number", unit: "days", min: 1, max: 365 },
      {
        key: "siteVisitRequiredCategories",
        label: "Site visit required for",
        kind: "multi",
        options: [
          { value: "residential", label: "Residential" },
          { value: "commercial", label: "Commercial" },
        ],
      },
      {
        key: "siteVisitRule",
        label: "When a required site visit is missing",
        kind: "select",
        options: [
          { value: "flag", label: "Flag the proposal" },
          { value: "block", label: "Block the proposal" },
        ],
      },
    ],
  },
  {
    section: "contracts",
    title: "Contracts and signing",
    description: "The shortest contract term, and the reminder sent while a contract is waiting to be signed.",
    fields: [
      { key: "minimumTermMonths", label: "Minimum term", kind: "number", unit: "months", min: 1, max: 120 },
      { key: "unsignedReminderDays", label: "Remind every", kind: "number", unit: "days", min: 1, max: 60 },
      { key: "unsignedReminderMax", label: "Stop after", kind: "number", unit: "reminders", min: 0, max: 20 },
      { key: "internalSignatoryIds", label: "Internal signatories (in order)", kind: "users", need: "contracts", hint: "Who signs for Yalla Fix It. Leave empty if only the client signs." },
      {
        key: "signingOrder",
        label: "Who signs first",
        kind: "select",
        options: [
          { value: "client_first", label: "The client, then Yalla Fix It" },
          { value: "internal_first", label: "Yalla Fix It, then the client" },
        ],
      },
      { key: "financeCcEmails", label: "Finance copy (Email 2)", kind: "list", hint: "Email addresses copied on every contract sent for signature." },
    ],
  },
  {
    section: "calendar",
    title: "Working calendar",
    description: "Days the visit schedule skips. Islamic holiday dates are estimates until they are announced.",
    fields: [
      { key: "weekendDays", label: "Non-working days", kind: "multi", options: WEEKDAYS, numeric: true },
      { key: "holidays", label: "Public holidays", kind: "holidays" },
    ],
  },
  {
    section: "scheduling",
    title: "PPM schedule and confirmation",
    description: "When each visit window opens, how early the client is asked to confirm, and how many times and how often they are contacted. These are the defaults for every contract.",
    fields: [
      { key: "serviceWindowDays", label: "Service window (first days of each cycle)", kind: "number", unit: "days", min: 1, max: 120 },
      { key: "confirmationLeadDays", label: "Confirmation to-do before the window", kind: "number", unit: "days", min: 0, max: 60 },
      { key: "attemptCount", label: "Confirmation attempts", kind: "number", min: 1, max: 10 },
      { key: "attemptIntervalDays", label: "At least this long between attempts", kind: "number", unit: "days", min: 0, max: 30 },
      {
        key: "attemptChannels",
        label: "Attempt channels",
        kind: "multi",
        options: [
          { value: "whatsapp", label: "WhatsApp" },
          { value: "call", label: "Call" },
          { value: "sms", label: "SMS" },
          { value: "email", label: "Email" },
        ],
      },
      /* "No-shows in a row that count as a used visit" is hidden (6 Nov): the
         rule only compares a visit with the try before it, so it stays at
         the default 2 (lib/amc/config.ts); any other number did nothing. */
      { key: "durationPerServiceMinutes", label: "Standard duration per service", kind: "number", unit: "minutes", min: 5, max: 1440 },
      { key: "durationPerExtraUnitMinutes", label: "Extra time per additional AC unit", kind: "number", unit: "minutes", min: 0, max: 600 },
      { key: "accessAlertDaysBefore", label: "Alert when access is not ready this close to a visit", kind: "number", unit: "days", min: 0, max: 60 },
      { key: "supervisorUserIds", label: "Supervisors", kind: "users", need: "visits", hint: "They review and close job sheets. None named: the level 1 approvers." },
      { key: "jobSheetGraceHours", label: "Job sheet not submitted after", kind: "number", unit: "hours", min: 1, max: 72 },
    ],
  },
  {
    section: "sla",
    title: "Service levels",
    description: "The response times promised in the contract (clauses 3.1 and 3.2), and how soon the service report must reach the client.",
    fields: [
      { key: "emergencyLogMinutes", label: "Emergency logged within", kind: "number", unit: "minutes", min: 1, max: 1440 },
      { key: "emergencyAttendMinutes", label: "Emergency attended within", kind: "number", unit: "minutes", min: 1, max: 1440 },
      { key: "nonEmergencyScheduleHours", label: "Non-emergency scheduled within", kind: "number", unit: "hours", min: 1, max: 720, hint: "A non-emergency call out meets its promise by being booked within this time after the client calls." },
      { key: "minorFixHours", label: "Minor fix up to", kind: "number", unit: "hours", min: 1, max: 24 },
      { key: "serviceReportHours", label: "Service report sent within", kind: "number", unit: "hours", min: 1, max: 720, hint: "The report must reach the client within this time after the visit is done. It counts as sent when it is emailed, or when the coordinator marks it sent (for example by WhatsApp)." },
      { key: "atRiskPercent", label: "Warn when this much of the time has passed", kind: "number", unit: "%", min: 1, max: 99 },
    ],
  },
  {
    section: "allowances",
    title: "Allowances",
    description: "When to warn that an allowance is nearly used up, and when allowances start again.",
    fields: [
      { key: "warningRemaining", label: "Warn when this many units remain", kind: "number", unit: "units", min: 0, max: 100 },
      {
        key: "resetBasis",
        label: "Allowances reset",
        kind: "select",
        options: [
          { value: "contract_year", label: "Every contract year" },
          { value: "contract_term", label: "Once per contract term" },
        ],
      },
    ],
  },
  {
    section: "renewals",
    title: "Renewals",
    description: "When the renewal reminder goes out (30 to 60 days before expiry), who is told when nothing happens, and the price increase on the renewal draft.",
    fields: [
      { key: "leadDays", label: "Remind before expiry", kind: "number", unit: "days", min: 30, max: 60 },
      { key: "notifyManagement", label: "Management", kind: "boolean", toggle: "Also remind management" },
      { key: "idleEscalationDays", label: "Escalate to management after", kind: "number", unit: "idle days", min: 1, max: 60 },
      { key: "escalationPercent", label: "Price escalation on the renewal draft", kind: "number", unit: "%", min: 0, max: 100, step: 0.5 },
    ],
  },
  {
    section: "additionalWork",
    title: "Additional work",
    description: "The fee added on top of materials used in additional work.",
    fields: [{ key: "materialHandlingFeePercent", label: "Material handling fee", kind: "number", unit: "%", min: 0, max: 100, step: 0.5 }],
  },
  {
    section: "clientReport",
    title: "Client report",
    description: "The opening and closing words of the client report, for residential and commercial contracts.",
    fields: [
      { key: "residentialIntro", label: "Opening, residential", kind: "text" },
      { key: "commercialIntro", label: "Opening, commercial", kind: "text" },
      { key: "closing", label: "Closing", kind: "text" },
    ],
  },
  {
    section: "todos",
    title: "To-dos",
    description: "AMC to-dos show in Todos for the people on the record.",
    fields: [
      {
        key: "emailReminders",
        label: "Email reminders",
        kind: "boolean",
        toggle: "Email reminders for AMC to-dos",
        hint: "When on, the people on an AMC to-do also get an email reminder before it is due.",
      },
    ],
  },
  {
    /* DEV-485: what the scheduler runs each morning. */
    section: "jobs",
    title: "Daily jobs",
    description:
      "What runs every morning at 06:00 Dubai time. The first release runs only the expiry notices and the PPM confirmation reminders; switch on more when the business is ready. Run now (below) runs every job at once.",
    fields: [
      {
        key: "scheduled",
        label: "Runs every morning",
        kind: "multi",
        layout: "list",
        options: DAILY_JOB_PARTS.map((p) => ({ value: p, label: DAILY_JOB_PART_LABELS[p] })),
      },
      {
        key: "clientEmails",
        label: "Client emails",
        kind: "boolean",
        toggle: "Let the daily jobs email clients",
        hint: "Off for the first release: reminders to clients (unsigned contract, instalment due, the visit the day before, contract expiry) are held, both on the schedule and with Run now. Emails you send yourself from a page are not affected.",
      },
    ],
  },
];

/** How the screen groups sections into views (kept in ?view=). */
export const CONFIG_VIEWS = [
  /* DEV-488: everyone the business names for go-live, as its own tab (23 Nov 2026). */
  { value: "people", label: "Named people", sections: [] },
  { value: "approvals", label: "Approvals and payments", sections: ["approvals", "payments"] },
  { value: "pipeline", label: "Pipeline and contracts", sections: ["enquiries", "proposals", "contracts"] },
  { value: "scheduling", label: "Scheduling and SLA", sections: ["calendar", "scheduling", "sla"] },
  { value: "delivery", label: "Allowances and renewals", sections: ["allowances", "renewals", "additionalWork", "clientReport", "todos"] },
  { value: "jobs", label: "Daily jobs", sections: ["jobs"] },
  { value: "templates", label: "Emails and messages", sections: [] },
  { value: "roles", label: "Roles and jobs", sections: [] },
  /* 24 Nov 2026: Operations settings (notifications, discount, site visit checklist), moved here from the AMC menu. */
  { value: "operations", label: "Operations", sections: [] },
  { value: "history", label: "Change history", sections: [] },
] as const;

export type ConfigView = (typeof CONFIG_VIEWS)[number]["value"];

/*
 * Hidden from the screen (6 Nov, at the user's request): "Allowances and
 * renewals" and "Roles and jobs". Their rules still run on the values saved
 * (or the defaults); the sections are simply not shown. Take a view out of
 * this set to show it again.
 */
export const HIDDEN_CONFIG_VIEWS: ReadonlySet<ConfigView> = new Set<ConfigView>(["delivery", "roles"]);
export const VISIBLE_CONFIG_VIEWS = CONFIG_VIEWS.filter((v) => !HIDDEN_CONFIG_VIEWS.has(v.value));
