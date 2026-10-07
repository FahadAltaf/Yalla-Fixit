import type { AmcConfigSection } from "@/lib/amc/config";

/**
 * How each AMC configuration section is laid out on the configuration
 * screen (DEV-419). One description per field drives one shared form, so
 * every section looks and behaves the same.
 */

export type FieldDef =
  | { key: string; label: string; kind: "number"; unit?: string; min?: number; max?: number; step?: number; nullable?: boolean; hint?: string }
  | { key: string; label: string; kind: "text"; hint?: string }
  | { key: string; label: string; kind: "boolean"; hint?: string }
  | { key: string; label: string; kind: "select"; options: Array<{ value: string; label: string }>; numeric?: boolean; hint?: string }
  | { key: string; label: string; kind: "multi"; options: Array<{ value: string; label: string }>; numeric?: boolean; hint?: string }
  | { key: string; label: string; kind: "users"; hint?: string }
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
      "BRD 5.5. Who approves at each level, and which discount, value, payment plan or below-floor price sends a proposal up. Approvers are named people, as in Snagging. Nobody approves their own proposal.",
    fields: [
      { key: "level1Name", label: "Level 1 name", kind: "text" },
      { key: "level1ApproverIds", label: "Level 1 approvers", kind: "users" },
      { key: "level2Name", label: "Level 2 name", kind: "text" },
      { key: "level2ApproverIds", label: "Level 2 approvers", kind: "users" },
      { key: "level3Name", label: "Level 3 name", kind: "text" },
      { key: "level3ApproverIds", label: "Level 3 approvers", kind: "users", hint: "Leave empty if there is no third level." },
      { key: "discountLevel1AbovePercent", label: "Discount above (level 1)", kind: "number", unit: "%", min: 0, max: 100, nullable: true },
      { key: "discountLevel2AbovePercent", label: "Discount above (level 2)", kind: "number", unit: "%", min: 0, max: 100, nullable: true },
      { key: "discountLevel3AbovePercent", label: "Discount above (level 3)", kind: "number", unit: "%", min: 0, max: 100, nullable: true },
      { key: "valueLevel1AboveAed", label: "Final value above (level 1)", kind: "number", unit: "AED", min: 0, nullable: true },
      { key: "valueLevel2AboveAed", label: "Final value above (level 2)", kind: "number", unit: "AED", min: 0, nullable: true },
      { key: "valueLevel3AboveAed", label: "Final value above (level 3)", kind: "number", unit: "AED", min: 0, nullable: true },
      { key: "nonStandardPlanLevel", label: "Non-standard payment plan goes to", kind: "select", options: LEVELS, numeric: true },
      { key: "belowFloorLevel", label: "Price below the floor rate goes to", kind: "select", options: LEVELS, numeric: true },
      { key: "escalateAfterHours", label: "Escalate an open approval after", kind: "number", unit: "hours", min: 1, max: 720 },
    ],
  },
  {
    section: "payments",
    title: "Payment value bands",
    description: "BRD 5.8. Below the band a contract is paid in one go; above it, one of the allowed plans. Another plan goes through approval.",
    fields: [
      { key: "singlePaymentBelowAed", label: "Single payment below", kind: "number", unit: "AED", min: 0 },
      { key: "plansAboveBand", label: "Plans allowed above the band", kind: "multi", options: PLANS },
      { key: "defaultPlanAboveBand", label: "Plan proposed above the band", kind: "select", options: PLANS },
      { key: "customPlanAllowed", label: "Allow another plan (always approved first)", kind: "boolean" },
      { key: "lateFirstPaymentDays", label: "Alert when the first payment is late by", kind: "number", unit: "days", min: 1, max: 90 },
      { key: "chequeAlertDaysBefore", label: "Alert before a cheque date", kind: "number", unit: "days", min: 0, max: 60 },
    ],
  },
  {
    section: "enquiries",
    title: "Enquiry pipeline",
    description: "BRD 5.1. Stages, sources and lost reasons are lists the team can change. An enquiry with no activity is flagged to its owner, then to management.",
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
    description: "BRD 5.2, 5.4. How long a proposal stays valid, and which properties need a site visit before a proposal.",
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
    description: "BRD 5.7. The shortest term, and the reminder sent while a contract is unsigned.",
    fields: [
      { key: "minimumTermMonths", label: "Minimum term", kind: "number", unit: "months", min: 1, max: 120 },
      { key: "unsignedReminderDays", label: "Remind every", kind: "number", unit: "days", min: 1, max: 60 },
      { key: "unsignedReminderMax", label: "Stop after", kind: "number", unit: "reminders", min: 0, max: 20 },
    ],
  },
  {
    section: "calendar",
    title: "Working calendar",
    description: "BRD 5.10. The PPM schedule skips these days. Islamic holiday dates are estimates until announced.",
    fields: [
      { key: "weekendDays", label: "Non-working days", kind: "multi", options: WEEKDAYS, numeric: true },
      { key: "holidays", label: "Public holidays", kind: "holidays" },
    ],
  },
  {
    section: "scheduling",
    title: "PPM schedule and confirmation",
    description: "BRD 5.10, 5.11. Service windows, the confirmation request before each window, and the attempt rule (the default for every contract).",
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
      { key: "noShowsConsumeVisit", label: "No-shows in a row that count as a used visit", kind: "number", min: 1, max: 10 },
      { key: "durationPerServiceMinutes", label: "Standard duration per service", kind: "number", unit: "minutes", min: 5, max: 1440 },
      { key: "durationPerExtraUnitMinutes", label: "Extra time per additional AC unit", kind: "number", unit: "minutes", min: 0, max: 600 },
      { key: "accessAlertDaysBefore", label: "Alert when access is not ready this close to a visit", kind: "number", unit: "days", min: 0, max: 60 },
    ],
  },
  {
    section: "sla",
    title: "Service levels",
    description: "BRD 5.12, 5.13. Contract clauses 3.1 and 3.2, and the 48-hour service report.",
    fields: [
      { key: "emergencyLogMinutes", label: "Emergency logged within", kind: "number", unit: "minutes", min: 1, max: 1440 },
      { key: "emergencyAttendMinutes", label: "Emergency attended within", kind: "number", unit: "minutes", min: 1, max: 1440 },
      { key: "nonEmergencyScheduleHours", label: "Non-emergency scheduled within", kind: "number", unit: "hours", min: 1, max: 720 },
      { key: "minorFixHours", label: "Minor fix up to", kind: "number", unit: "hours", min: 1, max: 24 },
      { key: "serviceReportHours", label: "Service report sent within", kind: "number", unit: "hours", min: 1, max: 720 },
      { key: "atRiskPercent", label: "Warn when this much of the time has passed", kind: "number", unit: "%", min: 1, max: 99 },
    ],
  },
  {
    section: "allowances",
    title: "Allowances",
    description: "BRD 5.14. The near-zero warning and when allowances start again.",
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
    description: "BRD 5.16. The reminder before expiry (30 to 60 days), escalation when nothing happens, and the price escalation on the renewal draft.",
    fields: [
      { key: "leadDays", label: "Remind before expiry", kind: "number", unit: "days", min: 30, max: 60 },
      { key: "notifyManagement", label: "Also remind management", kind: "boolean" },
      { key: "idleEscalationDays", label: "Escalate to management after", kind: "number", unit: "idle days", min: 1, max: 60 },
      { key: "escalationPercent", label: "Price escalation on the renewal draft", kind: "number", unit: "%", min: 0, max: 100, step: 0.5 },
    ],
  },
  {
    section: "additionalWork",
    title: "Additional work",
    description: "BRD 5.14: the material handling fee from the contract.",
    fields: [{ key: "materialHandlingFeePercent", label: "Material handling fee", kind: "number", unit: "%", min: 0, max: 100, step: 0.5 }],
  },
  {
    section: "todos",
    title: "To-dos",
    description: "BRD 6.8. AMC to-dos appear in Todos for the people on the record.",
    fields: [
      {
        key: "emailReminders",
        label: "Email reminders for AMC to-dos",
        kind: "boolean",
        hint: "Off for the demo: while the demo uses the live database, the live Todos reminder job would email the real assignees.",
      },
    ],
  },
];

/** How the screen groups sections into views (kept in ?view=). */
export const CONFIG_VIEWS = [
  { value: "approvals", label: "Approvals and payments", sections: ["approvals", "payments"] },
  { value: "pipeline", label: "Pipeline and contracts", sections: ["enquiries", "proposals", "contracts"] },
  { value: "scheduling", label: "Scheduling and SLA", sections: ["calendar", "scheduling", "sla"] },
  { value: "delivery", label: "Allowances and renewals", sections: ["allowances", "renewals", "additionalWork", "todos"] },
  { value: "templates", label: "Emails and messages", sections: [] },
  { value: "roles", label: "Roles and jobs", sections: [] },
  { value: "history", label: "Change history", sections: [] },
] as const;

export type ConfigView = (typeof CONFIG_VIEWS)[number]["value"];
