import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveAmcConfig } from "@/lib/amc/config";
import { activationSchema } from "@/lib/amc/contract-lifecycle";
import {
  addMonthsIso,
  ageingBucket,
  buildSchedule,
  checkAmount,
  gateOpen,
  instalmentStatus,
  outstandingOf,
  paymentActionSchema,
  rightFor,
  summarizeBalance,
} from "@/lib/amc/payments";

/* Phase 7 of the BRD v0.3 plan: payments without external integrations (DEV-352, 382-384, 386, Email 4, to-do 6). */

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x * 100, 0)) / 100;
const base = { grandTotal: 10_500, vatAmount: 500, activationDate: "2026-10-08", commencementDate: "2026-11-01", termMonths: 12 } as const;

test("schedule: one payment below the band, due on activation", () => {
  const rows = buildSchedule({ ...base, plan: "single" });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { instalmentNo: 1, label: "Full payment", dueDate: "2026-10-08", amount: 10_000, vatAmount: 500, total: 10_500 });
});

test("schedule: 50/50, quarterly and monthly split the contract, VAT and all, to the fils", () => {
  const half = buildSchedule({ ...base, plan: "fifty_fifty" });
  assert.deepEqual(half.map((r) => [r.dueDate, r.total, r.vatAmount]), [["2026-10-08", 5_250, 250], ["2027-05-01", 5_250, 250]]);

  const quarters = buildSchedule({ ...base, plan: "quarterly" });
  assert.deepEqual(quarters.map((r) => r.dueDate), ["2026-10-08", "2027-02-01", "2027-05-01", "2027-08-01"]);
  assert.equal(sum(quarters.map((r) => r.total)), 10_500);

  /* An amount that does not divide: the last instalment takes the fils. */
  const months = buildSchedule({ ...base, plan: "monthly", grandTotal: 1_000, vatAmount: 47.62 });
  assert.equal(months.length, 12);
  assert.equal(sum(months.map((r) => r.total)), 1_000);
  assert.equal(sum(months.map((r) => r.vatAmount)), 47.62);
  for (const r of months) assert.equal(Math.round((r.amount + r.vatAmount) * 100), Math.round(r.total * 100), "amount + VAT = total");
  assert.equal(months[1].dueDate, "2026-12-01");
});

test("schedule: a custom plan keeps its own names and shares", () => {
  const rows = buildSchedule({ ...base, plan: "custom", custom: [{ label: "On signing", percent: 30 }, { label: "Mid-term", percent: 70 }] });
  assert.deepEqual(rows.map((r) => [r.label, r.total, r.dueDate]), [["On signing", 3_150, "2026-10-08"], ["Mid-term", 7_350, "2027-05-01"]]);
});

test("schedule: month ends do not overflow", () => {
  assert.equal(addMonthsIso("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsIso("2028-01-31", 1), "2028-02-29");
});

test("status: from what came in and the date", () => {
  const f = { total: 1_000, receivedAmount: 0, dueDate: "2026-11-01", cheque: "none" as const, manual: null };
  assert.equal(instalmentStatus(f, "2026-10-01", 7), "not_due");
  assert.equal(instalmentStatus(f, "2026-10-26", 7), "due", "within the reminder window");
  assert.equal(instalmentStatus({ ...f, receivedAmount: 400 }, "2026-10-26", 7), "partially_received");
  assert.equal(instalmentStatus({ ...f, receivedAmount: 400 }, "2026-11-02", 7), "overdue", "short after the due date is overdue");
  assert.equal(instalmentStatus({ ...f, receivedAmount: 1_000 }, "2026-12-01", 7), "received");
  assert.equal(instalmentStatus({ ...f, cheque: "deposited" }, "2026-11-05", 7), "cheque_deposited");
  assert.equal(instalmentStatus({ ...f, cheque: "bounced" }, "2026-11-05", 7), "bounced");
  assert.equal(instalmentStatus({ ...f, manual: "waived" }, "2026-12-01", 7), "waived", "a person's decision stands");
  assert.equal(outstandingOf({ total: 1_000, receivedAmount: 400, status: "overdue" }), 600);
  assert.equal(outstandingOf({ total: 1_000, receivedAmount: 0, status: "written_off" }), 0);
});

test("balance and ageing", () => {
  assert.equal(ageingBucket("2026-10-10", "2026-10-08"), "current");
  assert.equal(ageingBucket("2026-09-30", "2026-10-08"), "d1_30");
  assert.equal(ageingBucket("2026-06-01", "2026-10-08"), "d90_plus");
  const s = summarizeBalance(
    [
      { total: 1_000, receivedAmount: 1_000, dueDate: "2026-09-01", status: "received" },
      { total: 1_000, receivedAmount: 250, dueDate: "2026-09-20", status: "overdue" },
      { total: 1_000, receivedAmount: 0, dueDate: "2026-12-01", status: "not_due" },
      { total: 500, receivedAmount: 0, dueDate: "2026-01-01", status: "written_off" },
    ],
    "2026-10-08",
  );
  assert.deepEqual([s.billed, s.received, s.outstanding, s.overdue, s.overdueCount], [3_000, 1_250, 1_750, 750, 1]);
  assert.equal(s.ageing.d1_30, 750);
  assert.equal(s.ageing.current, 1_000);
});

test("the initial payment gate opens on the first instalment, an override, or nothing to pay", () => {
  assert.equal(gateOpen({ total: 5_250, status: "due" }, false), false);
  assert.equal(gateOpen({ total: 5_250, status: "partially_received" }, false), false, "part of it is not the first instalment");
  assert.equal(gateOpen({ total: 5_250, status: "received" }, false), true);
  assert.equal(gateOpen({ total: 5_250, status: "due" }, true), true, "agreed credit terms");
  assert.equal(gateOpen({ total: 0, status: "due" }, false), true);
  assert.equal(gateOpen(null, false), true, "no schedule (payments not migrated): starts as before");
});

test("amounts: never more than is left, counting cheques already held", () => {
  assert.equal(checkAmount(600, { outstanding: 600, pendingCheques: 0 }), null);
  assert.match(checkAmount(601, { outstanding: 600, pendingCheques: 0 }) ?? "", /more than is left/);
  assert.match(checkAmount(100, { outstanding: 600, pendingCheques: 600 }) ?? "", /Nothing is left/);
});

test("actions: shapes and the right each needs", () => {
  const id = "7b1f3c2a-4d5e-4f60-8a71-92b3c4d5e6f7";
  assert.equal(paymentActionSchema.safeParse({ action: "record_payment", instalmentId: id, mode: "transfer", amount: 100, receivedOn: "2026-10-08" }).success, false, "a transfer needs its reference");
  assert.equal(paymentActionSchema.safeParse({ action: "record_payment", instalmentId: id, mode: "cash", amount: 100.5, receivedOn: "2026-10-08" }).success, true);
  assert.equal(paymentActionSchema.safeParse({ action: "record_payment", instalmentId: id, mode: "cash", amount: 100.555, receivedOn: "2026-10-08" }).success, false, "two decimals");
  assert.equal(paymentActionSchema.safeParse({ action: "cheque_bounce", chequeId: id, bouncedOn: "2026-10-08", reason: "" }).success, false, "a bounce says why");
  assert.equal(paymentActionSchema.safeParse({ action: "override_gate", reason: "Agreed 30-day credit" }).success, true);
  assert.equal(rightFor("override_gate"), "approve");
  assert.equal(rightFor("write_off"), "approve");
  assert.equal(rightFor("cheque_bounce"), "edit");
  assert.equal(rightFor("record_payment"), "create");
  assert.equal(activationSchema.safeParse({ action: "activate", commencementDate: "2026-11-01", termMonths: 12, startWithoutPayment: { reason: "x" } }).success, false);
  assert.equal(activationSchema.safeParse({ action: "activate", commencementDate: "2026-11-01", termMonths: 12, startWithoutPayment: { reason: "Agreed credit terms" } }).success, true);
});

test("configuration: a payments section saved before Phase 7 still validates, with the new defaults", () => {
  const { config, invalid } = resolveAmcConfig([
    {
      key: "payments",
      value: { singlePaymentBelowAed: 5_000, plansAboveBand: ["quarterly"], defaultPlanAboveBand: "quarterly", customPlanAllowed: false, lateFirstPaymentDays: 5, chequeAlertDaysBefore: 2 },
    },
  ]);
  assert.deepEqual(invalid, []);
  assert.equal(config.payments.singlePaymentBelowAed, 5_000);
  assert.equal(config.payments.dueReminderDaysBefore, 7);
  assert.deepEqual(config.payments.financeUserIds, []);
});

test("migration: branch-only tables, nine statuses, history kept, nothing on the live table", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261008100000_amc_payments.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  for (const s of ["not_due", "due", "partially_received", "received", "overdue", "cheque_deposited", "bounced", "written_off", "waived"]) {
    assert.match(sql, new RegExp(`'${s}'`), s);
  }
  for (const t of ["amc_instalments", "amc_cheques", "amc_payments"]) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`), `${t} RLS`);
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${t} FROM anon, authenticated`), `${t} revoked`);
  }
  assert.match(sql, /amc_contracts_gate_override_shape/);
  assert.match(sql, /BEFORE DELETE ON public\.amc_payments/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /amc_submissions/, "the live table is not touched");
  assert.doesNotMatch(sql, /DROP TABLE|SECURITY DEFINER/);
});
