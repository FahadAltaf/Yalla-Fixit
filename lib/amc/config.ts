import { z } from "zod";

import { templatesConfigSchema } from "./message-templates";

/**
 * AMC configuration (DEV-357, BRD v0.3): every value the business will
 * change without a release. Pure (zod only): used by the API, the
 * configuration screen and the tests.
 *
 * Stored one row per section in `amc_config` (migration 20261007110000),
 * holding only what someone saved; the code holds the defaults, as AMC
 * Settings does. A stored section that no longer validates (an older shape)
 * falls back to the defaults rather than breaking every screen.
 *
 * Defaults are the plan's assumptions (docs/amc-brd-v0.3-implementation-plan.md
 * §5, Q1-Q26) until the business confirms them.
 *
 * Who edits what (BRD 6.7): "management" sections (approval thresholds and
 * payment value bands) need AMC Configuration Approve; the rest need AMC
 * Configuration Edit. Admins inherit both.
 */

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const money = z.number().min(0).max(100_000_000);
const optionalMoney = money.nullable();
const optionalPercent = z.number().min(0).max(100).nullable();
const text = (max = 200) => z.string().trim().min(1).max(max);
const textList = (maxItems = 40, max = 80) => z.array(text(max)).min(1).max(maxItems);
const uuidList = z.array(z.string().uuid()).max(50);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PAYMENT_PLAN_TYPES = ["single", "fifty_fifty", "quarterly", "monthly"] as const;
export type PaymentPlanType = (typeof PAYMENT_PLAN_TYPES)[number];
export const MESSAGE_CHANNELS = ["whatsapp", "call", "sms", "email"] as const;

/* ------------------------------------------------------------------ */
/* Section schemas                                                     */
/* ------------------------------------------------------------------ */

const approvalsSchema = z
  .object({
    level1Name: text(60),
    level1ApproverIds: uuidList,
    level2Name: text(60),
    level2ApproverIds: uuidList,
    level3Name: text(60),
    level3ApproverIds: uuidList,
    discountLevel1AbovePercent: optionalPercent,
    discountLevel2AbovePercent: optionalPercent,
    discountLevel3AbovePercent: optionalPercent,
    valueLevel1AboveAed: optionalMoney,
    valueLevel2AboveAed: optionalMoney,
    valueLevel3AboveAed: optionalMoney,
    nonStandardPlanLevel: int(1, 3),
    belowFloorLevel: int(1, 3),
    escalateAfterHours: int(1, 720),
  })
  .strict();

const paymentsSchema = z
  .object({
    singlePaymentBelowAed: money,
    plansAboveBand: z.array(z.enum(PAYMENT_PLAN_TYPES)).min(1),
    defaultPlanAboveBand: z.enum(PAYMENT_PLAN_TYPES),
    customPlanAllowed: z.boolean(),
    lateFirstPaymentDays: int(1, 90),
    chequeAlertDaysBefore: int(0, 60),
  })
  .strict()
  .refine((v) => v.plansAboveBand.includes(v.defaultPlanAboveBand), {
    message: "The default plan above the band must be one of the allowed plans",
    path: ["defaultPlanAboveBand"],
  });

const proposalsSchema = z
  .object({
    validityDays: int(1, 365),
    siteVisitRequiredCategories: z.array(z.enum(["residential", "commercial"])).max(2),
    siteVisitRule: z.enum(["flag", "block"]),
  })
  .strict();

const enquiriesSchema = z
  .object({
    stages: textList(30),
    sources: textList(30),
    lostReasons: textList(30),
    idleDays: int(1, 90),
    managementEscalationDays: int(1, 180),
  })
  .strict()
  .refine((v) => v.managementEscalationDays >= v.idleDays, {
    message: "Management escalation must come on or after the idle flag",
    path: ["managementEscalationDays"],
  });

const contractsSchema = z
  .object({
    minimumTermMonths: int(1, 120),
    unsignedReminderDays: int(1, 60),
    unsignedReminderMax: int(0, 20),
  })
  .strict();

const holidaySchema = z.object({ date: isoDate, name: text(80) }).strict();
const calendarSchema = z
  .object({
    /* 0 = Sunday … 6 = Saturday. */
    weekendDays: z.array(int(0, 6)).max(6),
    holidays: z.array(holidaySchema).max(200),
  })
  .strict();

const schedulingSchema = z
  .object({
    serviceWindowDays: int(1, 120),
    confirmationLeadDays: int(0, 60),
    attemptCount: int(1, 10),
    attemptIntervalDays: int(0, 30),
    attemptChannels: z.array(z.enum(MESSAGE_CHANNELS)).min(1),
    noShowsConsumeVisit: int(1, 10),
    durationPerServiceMinutes: int(5, 1440),
    durationPerExtraUnitMinutes: int(0, 600),
    accessAlertDaysBefore: int(0, 60),
  })
  .strict();

const slaSchema = z
  .object({
    emergencyLogMinutes: int(1, 1440),
    emergencyAttendMinutes: int(1, 1440),
    nonEmergencyScheduleHours: int(1, 720),
    minorFixHours: int(1, 24),
    serviceReportHours: int(1, 720),
    atRiskPercent: int(1, 99),
  })
  .strict();

const allowancesSchema = z
  .object({
    warningRemaining: int(0, 100),
    resetBasis: z.enum(["contract_year", "contract_term"]),
  })
  .strict();

const renewalsSchema = z
  .object({
    leadDays: int(30, 60),
    notifyManagement: z.boolean(),
    idleEscalationDays: int(1, 60),
    escalationPercent: z.number().min(0).max(100),
  })
  .strict();

const additionalWorkSchema = z
  .object({
    materialHandlingFeePercent: z.number().min(0).max(100),
  })
  .strict();

const todosSchema = z
  .object({
    /* Live `main` emails any to-do whose reminder time is set, so AMC
       to-dos carry none unless this is switched on. */
    emailReminders: z.boolean(),
  })
  .strict();

export const AMC_CONFIG_SCHEMAS = {
  approvals: approvalsSchema,
  payments: paymentsSchema,
  proposals: proposalsSchema,
  enquiries: enquiriesSchema,
  contracts: contractsSchema,
  calendar: calendarSchema,
  scheduling: schedulingSchema,
  sla: slaSchema,
  allowances: allowancesSchema,
  renewals: renewalsSchema,
  additionalWork: additionalWorkSchema,
  todos: todosSchema,
  /* Email and WhatsApp/SMS texts: saved changes only (lib/amc/message-templates.ts). */
  templates: templatesConfigSchema,
} as const;

export type AmcConfigSection = keyof typeof AMC_CONFIG_SCHEMAS;
export type AmcConfig = { [K in AmcConfigSection]: z.infer<(typeof AMC_CONFIG_SCHEMAS)[K]> };
export const AMC_CONFIG_SECTIONS = Object.keys(AMC_CONFIG_SCHEMAS) as AmcConfigSection[];

/** "management" = AMC Configuration Approve (BRD 6.7); "admin" = AMC Configuration Edit. */
export const AMC_CONFIG_SECTION_LEVEL: Record<AmcConfigSection, "management" | "admin"> = {
  approvals: "management",
  payments: "management",
  proposals: "admin",
  enquiries: "admin",
  contracts: "admin",
  calendar: "admin",
  scheduling: "admin",
  sla: "admin",
  allowances: "admin",
  renewals: "admin",
  additionalWork: "admin",
  todos: "admin",
  templates: "admin",
};

export function isAmcConfigSection(value: unknown): value is AmcConfigSection {
  return typeof value === "string" && (AMC_CONFIG_SECTIONS as string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Defaults (plan §5; Q-numbers in the plan's assumptions table)       */
/* ------------------------------------------------------------------ */

export const AMC_CONFIG_DEFAULTS: AmcConfig = {
  approvals: {
    level1Name: "AMC department head",
    level1ApproverIds: [],
    level2Name: "Management",
    level2ApproverIds: [],
    level3Name: "Level 3",
    level3ApproverIds: [],
    discountLevel1AbovePercent: 10,
    discountLevel2AbovePercent: 20,
    discountLevel3AbovePercent: null,
    valueLevel1AboveAed: null,
    valueLevel2AboveAed: 50_000,
    valueLevel3AboveAed: null,
    nonStandardPlanLevel: 1,
    belowFloorLevel: 1,
    escalateAfterHours: 24,
  },
  payments: {
    singlePaymentBelowAed: 4_000,
    plansAboveBand: ["fifty_fifty", "quarterly", "monthly"],
    defaultPlanAboveBand: "fifty_fifty",
    customPlanAllowed: true,
    lateFirstPaymentDays: 7,
    chequeAlertDaysBefore: 3,
  },
  proposals: {
    validityDays: 30,
    siteVisitRequiredCategories: ["commercial"],
    siteVisitRule: "flag",
  },
  enquiries: {
    stages: [
      "New Enquiry",
      "Contacted",
      "Qualified",
      "Details Captured",
      "Site Visit Scheduled",
      "Proposal Preparation",
      "Proposal Submitted",
      "Under Negotiation",
      "Awaiting Decision",
      "Won",
      "Lost",
      "On Hold",
    ],
    sources: ["SEO", "Website", "Referral", "Walk in", "Repeat client", "Campaign"],
    lostReasons: ["Price", "Competitor", "Scope", "No response", "Deferred"],
    idleDays: 5,
    managementEscalationDays: 10,
  },
  contracts: {
    minimumTermMonths: 12,
    unsignedReminderDays: 3,
    unsignedReminderMax: 3,
  },
  calendar: {
    weekendDays: [0],
    /* UAE public holidays. Islamic dates are estimates until announced. */
    holidays: [
      { date: "2026-12-01", name: "Commemoration Day" },
      { date: "2026-12-02", name: "National Day" },
      { date: "2026-12-03", name: "National Day holiday" },
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-03-09", name: "Eid al-Fitr (estimated)" },
      { date: "2027-03-10", name: "Eid al-Fitr holiday (estimated)" },
      { date: "2027-03-11", name: "Eid al-Fitr holiday (estimated)" },
      { date: "2027-05-15", name: "Arafat Day (estimated)" },
      { date: "2027-05-16", name: "Eid al-Adha (estimated)" },
      { date: "2027-05-17", name: "Eid al-Adha holiday (estimated)" },
      { date: "2027-05-18", name: "Eid al-Adha holiday (estimated)" },
      { date: "2027-06-06", name: "Islamic New Year (estimated)" },
      { date: "2027-08-14", name: "Prophet's Birthday (estimated)" },
      { date: "2027-12-01", name: "Commemoration Day" },
      { date: "2027-12-02", name: "National Day" },
      { date: "2027-12-03", name: "National Day holiday" },
    ],
  },
  scheduling: {
    serviceWindowDays: 15,
    confirmationLeadDays: 7,
    attemptCount: 3,
    attemptIntervalDays: 2,
    attemptChannels: ["whatsapp", "call", "email"],
    noShowsConsumeVisit: 2,
    durationPerServiceMinutes: 60,
    durationPerExtraUnitMinutes: 30,
    accessAlertDaysBefore: 2,
  },
  sla: {
    emergencyLogMinutes: 60,
    emergencyAttendMinutes: 120,
    nonEmergencyScheduleHours: 48,
    minorFixHours: 2,
    serviceReportHours: 48,
    atRiskPercent: 75,
  },
  allowances: {
    warningRemaining: 1,
    resetBasis: "contract_year",
  },
  renewals: {
    leadDays: 30,
    notifyManagement: true,
    idleEscalationDays: 15,
    escalationPercent: 5,
  },
  additionalWork: {
    materialHandlingFeePercent: 20,
  },
  todos: {
    emailReminders: false,
  },
  templates: {},
};

/* ------------------------------------------------------------------ */
/* Reading and validating                                              */
/* ------------------------------------------------------------------ */

export interface ResolvedAmcConfig {
  config: AmcConfig;
  /** Sections with a saved value (the rest show the defaults). */
  saved: AmcConfigSection[];
  /** Saved sections that no longer validate and fell back to defaults. */
  invalid: AmcConfigSection[];
}

/** Stored rows ({ key, value }) → the full configuration. Unknown keys are ignored. */
export function resolveAmcConfig(rows: Array<{ key: string; value: unknown }>): ResolvedAmcConfig {
  const config = structuredClone(AMC_CONFIG_DEFAULTS) as AmcConfig;
  const saved: AmcConfigSection[] = [];
  const invalid: AmcConfigSection[] = [];
  for (const row of rows) {
    if (!isAmcConfigSection(row.key)) continue;
    const parsed = AMC_CONFIG_SCHEMAS[row.key].safeParse(row.value);
    if (parsed.success) {
      (config as Record<AmcConfigSection, unknown>)[row.key] = parsed.data;
      saved.push(row.key);
    } else {
      invalid.push(row.key);
    }
  }
  return { config, saved, invalid };
}

export type SectionValidation =
  | { ok: true; value: AmcConfig[AmcConfigSection] }
  | { ok: false; error: string };

export function validateAmcConfigSection(section: AmcConfigSection, value: unknown): SectionValidation {
  const parsed = AMC_CONFIG_SCHEMAS[section].safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, error: `${where}${issue?.message ?? "Invalid value"}` };
}

/** The fields whose value differs, for the change history (BRD 5.3/6.9: old and new value). */
export function diffAmcConfigSection(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Array<{ field: string; before: unknown; after: unknown }> {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const field of fields) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      changes.push({ field, before: before[field] ?? null, after: after[field] ?? null });
    }
  }
  return changes;
}

/* ------------------------------------------------------------------ */
/* Helpers later phases use                                            */
/* ------------------------------------------------------------------ */

/** The approvers named for a level (1-3). */
export function approversForLevel(config: AmcConfig, level: number): string[] {
  const a = config.approvals;
  return level === 1 ? a.level1ApproverIds : level === 2 ? a.level2ApproverIds : level === 3 ? a.level3ApproverIds : [];
}

/** Whether a date (YYYY-MM-DD) is a weekend day or a holiday. */
export function isNonWorkingDay(config: AmcConfig, isoDay: string): boolean {
  const weekday = new Date(`${isoDay}T00:00:00Z`).getUTCDay();
  return config.calendar.weekendDays.includes(weekday) || config.calendar.holidays.some((h) => h.date === isoDay);
}
