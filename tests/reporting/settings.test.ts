import { test } from "node:test";
import assert from "node:assert/strict";

import {
  diffSettingsPaths,
  getReportingSettingsDefaults,
  mergeReportingSettings,
  overridesFrom,
  reportingSettingsOverridesSchema,
  reportingSettingsSchema,
  validateReportingSettings,
} from "@/lib/reporting/settings";

test("the defaults are a complete, valid settings document", () => {
  assert.ok(reportingSettingsSchema.safeParse(getReportingSettingsDefaults()).success);
});

test("the BRD §6.6 suggestions are the defaults", () => {
  const d = getReportingSettingsDefaults();
  assert.equal(d.finance.digestTimeLocal, "08:00");
  assert.equal(d.finance.agedAfterDays, 7);
  assert.deepEqual(d.quotations.ageingDaysByStatus, { notSent: 7, sent: 10, approved: 5 });
  assert.equal(d.quotations.expiryWarningDays, 5);
  assert.equal(d.attendance.shiftCheckInAlertDelayMinutes, 15);
  assert.equal(d.attendance.appointmentCheckInAlertDelayMinutes, 15);
  assert.equal(d.attendance.lateArrivalToleranceMinutes, 15);
  assert.equal(d.compliance.penaltyPerMissAed, 50);
  assert.equal(d.compliance.monthlyCapAed, 500);
  assert.equal(d.compliance.disputeCutoffDay, 25);
  assert.equal(d.capacity.horizonDays, 14);
  assert.equal(d.exceptions.completedWithoutFlagAfterDays, 3);
});

test("the compliance threshold has no default (D-09: 90 % or 97 % is undecided)", () => {
  assert.equal(getReportingSettingsDefaults().compliance.thresholdPercent, null);
});

test("the unpaid break is 0 until D-22 decides 8 h or 9 h", () => {
  assert.equal(getReportingSettingsDefaults().attendance.unpaidBreakMinutes, 0);
});

test("an override changes only the keys it names", () => {
  const { settings, valid } = mergeReportingSettings(getReportingSettingsDefaults(), {
    quotations: { ageingDaysByStatus: { sent: 12 } },
    compliance: { thresholdPercent: 97 },
  });
  assert.equal(valid, true);
  assert.deepEqual(settings.quotations.ageingDaysByStatus, { notSent: 7, sent: 12, approved: 5 });
  assert.equal(settings.compliance.thresholdPercent, 97);
  assert.equal(settings.compliance.penaltyPerMissAed, 50);
});

test("recipient lists are replaced, not merged", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const base = mergeReportingSettings(getReportingSettingsDefaults(), {
    finance: { digestRecipientUserIds: [id] },
  }).settings;
  const { settings } = mergeReportingSettings(base, { finance: { digestRecipientUserIds: [] } });
  assert.deepEqual(settings.finance.digestRecipientUserIds, []);
});

test("unknown keys are refused, so a typo is never stored as a setting", () => {
  assert.equal(reportingSettingsOverridesSchema.safeParse({ finance: { digestTime: "09:00" } }).success, false);
  assert.equal(reportingSettingsOverridesSchema.safeParse({ payroll: {} }).success, false);
  assert.equal(
    reportingSettingsOverridesSchema.safeParse({ quotations: { ageingDaysByStatus: { rejected: 3 } } }).success,
    false,
  );
});

test("out-of-range and malformed values are refused", () => {
  const bad = [
    { finance: { digestTimeLocal: "8am" } },
    { finance: { digestTimeLocal: "24:00" } },
    { finance: { agedAfterDays: -1 } },
    { finance: { agedAfterDays: 2.5 } },
    { finance: { digestRecipientUserIds: ["not-a-uuid"] } },
    { compliance: { thresholdPercent: 101 } },
    { compliance: { disputeCutoffDay: 31 } },
    { compliance: { penaltyPerMissAed: 50.001 } },
    { capacity: { horizonDays: 0 } },
  ];
  for (const overrides of bad) {
    assert.equal(reportingSettingsOverridesSchema.safeParse(overrides).success, false, JSON.stringify(overrides));
  }
});

test("a stored override that no longer validates falls back to the defaults", () => {
  const { settings, valid } = mergeReportingSettings(
    getReportingSettingsDefaults(),
    { capacity: { horizonDays: 500 } } as never,
  );
  assert.equal(valid, false);
  assert.equal(settings.capacity.horizonDays, 14);
});

test("a monthly cap below one miss's penalty is reported against the cap", () => {
  const { settings } = mergeReportingSettings(getReportingSettingsDefaults(), {
    compliance: { penaltyPerMissAed: 100, monthlyCapAed: 50 },
  });
  assert.deepEqual(Object.keys(validateReportingSettings(settings)), ["compliance.monthlyCapAed"]);
  assert.deepEqual(validateReportingSettings(getReportingSettingsDefaults()), {});
});

test("the audit diff names each changed leaf, and nothing else", () => {
  const before = getReportingSettingsDefaults();
  const after = mergeReportingSettings(before, {
    quotations: { ageingDaysByStatus: { approved: 6 } },
    compliance: { thresholdPercent: 90 },
  }).settings;
  assert.deepEqual(diffSettingsPaths(before, after), [
    "compliance.thresholdPercent",
    "quotations.ageingDaysByStatus.approved",
  ]);
  assert.deepEqual(diffSettingsPaths(before, before), []);
});

test("the audit diff reports leaves of a section present on one side only", () => {
  assert.deepEqual(diffSettingsPaths({}, { finance: { agedAfterDays: 9 } }), ["finance.agedAfterDays"]);
  assert.deepEqual(diffSettingsPaths({ finance: { agedAfterDays: 9 } }, {}), ["finance.agedAfterDays"]);
});

test("only the fields that differ from the defaults are saved", () => {
  const defaults = getReportingSettingsDefaults();
  assert.deepEqual(overridesFrom(defaults, defaults), {});
  const draft = structuredClone(defaults);
  draft.quotations.ageingDaysByStatus.sent = 12;
  draft.compliance.thresholdPercent = 97;
  const overrides = overridesFrom(defaults, draft);
  assert.deepEqual(overrides, {
    quotations: { ageingDaysByStatus: { sent: 12 } },
    compliance: { thresholdPercent: 97 },
  });
  assert.ok(reportingSettingsOverridesSchema.safeParse(overrides).success);
  assert.deepEqual(mergeReportingSettings(defaults, overrides).settings, draft);
});

test("setting a field back to its default removes the override", () => {
  const defaults = getReportingSettingsDefaults();
  const draft = structuredClone(defaults);
  draft.finance.agedAfterDays = 7;
  assert.deepEqual(overridesFrom(defaults, draft), {});
});
