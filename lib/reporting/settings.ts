import { z } from "zod";

/**
 * Reporting Settings (BRD §6.4, §6.6; DEV-461).
 *
 * The AMC Settings pattern: the code holds the defaults, the database holds
 * only what an administrator has changed (`reporting_settings.overrides`),
 * and the two are merged on read. A fresh database, or a missing row, still
 * works on the defaults alone.
 *
 * The defaults are the BRD's §6.6 suggestions, which it says are "to be
 * confirmed with Sharon". They are shown as suggestions on the page until
 * someone saves a value. One setting has no default on purpose:
 *
 *   compliance.thresholdPercent  90 % (meeting) or 97 % (document)? (D-09)
 *     TC12's expected penalty only holds at 97 %, so picking either would
 *     be deciding an employee-penalty rule in code. Penalties are not
 *     calculated until an administrator sets it.
 */

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

const wholeDays = (max: number) => z.number().int().min(0).max(max);
const minutes = z.number().int().min(0).max(240);
const aed = z.number().min(0).max(100_000).multipleOf(0.01);
const userIds = z.array(z.uuid()).max(50);

export const reportingSettingsSchema = z.object({
  finance: z.object({
    /** E1 / N1: when the daily digest goes out, Asia/Dubai. */
    digestTimeLocal: z.string().regex(HH_MM, "Use HH:MM, 24-hour"),
    /** E1: who receives it. Empty = nobody until set. */
    digestRecipientUserIds: userIds,
    /** N2 and the digest: days in Pending before an item counts as aged. */
    agedAfterDays: wholeDays(365),
  }),
  quotations: z.object({
    /** N7: days a quotation may sit in each status before it is flagged.
        Keyed by the BRD's status names; their mapping onto FSM's own
        values is D-13. */
    ageingDaysByStatus: z.object({
      notSent: wholeDays(365),
      sent: wholeDays(365),
      approved: wholeDays(365),
    }),
    /** N8: warn this many days before a quotation's validity ends. */
    expiryWarningDays: wholeDays(365),
    /** N7: who hears about a quotation past its limit (BRD: Behrouz and
        the managers). Empty = nobody until set. */
    alertRecipientUserIds: userIds,
  }),
  attendance: z.object({
    /** N5 and N6 are set independently (BRD §6.6). */
    shiftCheckInAlertDelayMinutes: minutes,
    appointmentCheckInAlertDelayMinutes: minutes,
    lateArrivalToleranceMinutes: minutes,
    /** Subtracted from each shift for available hours. 0 until D-22 says
        whether a working day is 8 h or 9 h. */
    unpaidBreakMinutes: minutes,
  }),
  compliance: z.object({
    /** No default: see the note at the top (D-09). */
    thresholdPercent: z.number().min(0).max(100).nullable(),
    penaltyPerMissAed: aed,
    monthlyCapAed: aed,
    /** Disputes close on this day of the month (1-28, so every month has it). */
    disputeCutoffDay: z.number().int().min(1).max(28),
    /** E3: the final monthly report. Empty = nobody until set. */
    hrRecipientUserIds: userIds,
  }),
  capacity: z.object({
    horizonDays: z.number().int().min(1).max(90),
  }),
  exceptions: z.object({
    /** N13: a completed job still without the invoice flag after this many days. */
    completedWithoutFlagAfterDays: wholeDays(365),
  }),
});

export type ReportingSettings = z.infer<typeof reportingSettingsSchema>;

/*
  What an administrator has changed: any subset of any section. Unknown
  keys are refused rather than stored, so a typo cannot sit in the row
  looking like a setting.
*/
const shape = reportingSettingsSchema.shape;
export const reportingSettingsOverridesSchema = z
  .object({
    finance: shape.finance.partial().strict(),
    quotations: shape.quotations
      .extend({ ageingDaysByStatus: shape.quotations.shape.ageingDaysByStatus.partial().strict() })
      .partial()
      .strict(),
    attendance: shape.attendance.partial().strict(),
    compliance: shape.compliance.partial().strict(),
    capacity: shape.capacity.partial().strict(),
    exceptions: shape.exceptions.partial().strict(),
  })
  .partial()
  .strict();

export type ReportingSettingsOverrides = z.infer<typeof reportingSettingsOverridesSchema>;

export function getReportingSettingsDefaults(): ReportingSettings {
  return {
    finance: { digestTimeLocal: "08:00", digestRecipientUserIds: [], agedAfterDays: 7 },
    quotations: {
      ageingDaysByStatus: { notSent: 7, sent: 10, approved: 5 },
      expiryWarningDays: 5,
      alertRecipientUserIds: [],
    },
    attendance: {
      shiftCheckInAlertDelayMinutes: 15,
      appointmentCheckInAlertDelayMinutes: 15,
      lateArrivalToleranceMinutes: 15,
      unpaidBreakMinutes: 0,
    },
    compliance: {
      thresholdPercent: null,
      penaltyPerMissAed: 50,
      monthlyCapAed: 500,
      disputeCutoffDay: 25,
      hrRecipientUserIds: [],
    },
    capacity: { horizonDays: 14 },
    exceptions: { completedWithoutFlagAfterDays: 3 },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* Key by key; arrays and null replace rather than merge. */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : patch) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = key in base ? deepMerge((base as Record<string, unknown>)[key], value) : value;
  }
  return out as T;
}

/**
 * Defaults with the administrator's changes applied. The result is checked
 * against the full schema; if a stored override has become invalid (a range
 * tightened in a later release), the defaults are used instead of a value
 * no report can trust, and the caller is told which.
 */
export function mergeReportingSettings(
  defaults: ReportingSettings,
  overrides: ReportingSettingsOverrides | null | undefined,
): { settings: ReportingSettings; valid: boolean } {
  const merged = deepMerge(defaults, overrides ?? {});
  const parsed = reportingSettingsSchema.safeParse(merged);
  return parsed.success ? { settings: parsed.data, valid: true } : { settings: defaults, valid: false };
}

/**
 * Cross-field rules a single field's range cannot express. Returned as
 * messages keyed by path, so the page can show each beside its field.
 */
export function validateReportingSettings(settings: ReportingSettings): Record<string, string> {
  const problems: Record<string, string> = {};
  const { penaltyPerMissAed, monthlyCapAed } = settings.compliance;
  if (monthlyCapAed < penaltyPerMissAed) {
    problems["compliance.monthlyCapAed"] = "The monthly cap is below the penalty for a single miss.";
  }
  return problems;
}

/** The key paths a save changed, for the audit trail and the History tab. */
export function diffSettingsPaths(before: unknown, after: unknown, prefix = ""): string[] {
  /* A section present on one side only is compared against an empty one,
     so the leaves are reported rather than the section's name. */
  const a = before === undefined && isPlainObject(after) ? {} : before;
  const b = after === undefined && isPlainObject(before) ? {} : after;
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].sort().flatMap((key) =>
      diffSettingsPaths(a[key], b[key], prefix ? `${prefix}.${key}` : key),
    );
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix];
}

/**
 * The overrides document for a full settings draft: only what differs from
 * the defaults. Saving the whole draft instead would freeze every default
 * at today's value, and a later change to a default would never reach
 * anyone. Arrays and null compare whole.
 */
export function overridesFrom(
  defaults: ReportingSettings,
  draft: ReportingSettings,
): ReportingSettingsOverrides {
  const diff = (base: unknown, value: unknown): unknown => {
    if (isPlainObject(base) && isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value)) {
        const d = diff(base[key], value[key]);
        if (d !== undefined) out[key] = d;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }
    return JSON.stringify(base) === JSON.stringify(value) ? undefined : value;
  };
  return (diff(defaults, draft) ?? {}) as ReportingSettingsOverrides;
}
