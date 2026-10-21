import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildQuotationRows,
  filterQuotations,
  sortQuotationRows,
  statusOf,
  summariseByStatus,
  valueBandOf,
  type QuotationRecord,
} from "@/lib/reports/quotations";

const TODAY = "2026-10-21";
const LIMITS = { notSent: 7, sent: 10, approved: 5 };
const options = { today: TODAY, limits: LIMITS, expiryWarningDays: 5, timeZone: "Asia/Dubai" };
const q = (patch: Partial<QuotationRecord>): QuotationRecord => ({
  id: "E1",
  number: "17001",
  status: "New",
  value: 1000,
  ownerName: "Owner One",
  ownerEmail: "owner.one@test.local",
  clientName: "Client A",
  createdAt: "2026-10-01T06:00:00Z",
  expiryDate: null,
  statusChangedAt: "2026-10-01T06:00:00Z",
  statusSinceEstimated: false,
  approvedAt: null,
  rejectedAt: null,
  expiredAt: null,
  ...patch,
});
/* 08:00 Dubai on a date. */
const at = (date: string) => `${date}T04:00:00Z`;

test("FSM statuses map onto the BRD's; an unknown value keeps its own name", () => {
  assert.equal(statusOf("New").key, "notSent");
  assert.equal(statusOf("converted to work order").key, "converted");
  assert.deepEqual(statusOf("On Review"), { key: "other:On Review", label: "On Review", open: false, awaitingClient: false });
  assert.equal(statusOf(null).label, "No status");
});

test("TC07: Sent for 11 days against a 10-day limit is past the limit; 10 days is not", () => {
  const [eleven, ten] = buildQuotationRows(
    [
      q({ id: "a", status: "Sent", statusChangedAt: at("2026-10-10") }),
      q({ id: "b", status: "Sent", statusChangedAt: at("2026-10-11") }),
    ],
    options,
  );
  assert.equal(eleven.daysInStatus, 11);
  assert.equal(eleven.breached, true);
  assert.equal(ten.daysInStatus, 10);
  assert.equal(ten.breached, false);
});

test("before the sync saw a change, the matching FSM timestamp stands in, else it is an estimate", () => {
  const [approved, sent] = buildQuotationRows(
    [
      q({ status: "Approved", statusSinceEstimated: true, statusChangedAt: at("2026-10-20"), approvedAt: at("2026-10-12") }),
      q({ status: "Sent", statusSinceEstimated: true, statusChangedAt: at("2026-10-19") }),
    ],
    options,
  );
  assert.equal(approved.daysInStatus, 9);
  assert.equal(approved.statusSinceExact, true);
  assert.equal(approved.breached, true, "Approved for 9 days, limit 5");
  assert.equal(sent.daysInStatus, 2);
  assert.equal(sent.statusSinceExact, false);
});

test("closed statuses never breach; days count in Dubai calendar days", () => {
  const [converted, lateEvening] = buildQuotationRows(
    [
      q({ status: "Converted to Work Order", statusChangedAt: at("2026-01-01") }),
      /* 23:30 Dubai on the 13th is still the 13th. */
      q({ status: "New", statusChangedAt: "2026-10-13T19:30:00Z" }),
    ],
    options,
  );
  assert.equal(converted.breached, false);
  assert.equal(converted.ageingLimit, null);
  assert.equal(lateEvening.daysInStatus, 8);
  assert.equal(lateEvening.breached, true);
});

test("expiry: warned within 5 days while waiting on the client; past validity after it", () => {
  const [soon, edge, later, past, approved] = buildQuotationRows(
    [
      q({ status: "Sent", expiryDate: "2026-10-24" }),
      q({ status: "New", expiryDate: "2026-10-26" }),
      q({ status: "Sent", expiryDate: "2026-10-27" }),
      q({ status: "Sent", expiryDate: "2026-10-20" }),
      q({ status: "Approved", expiryDate: "2026-10-22" }),
    ],
    options,
  );
  assert.deepEqual([soon.daysToExpiry, soon.expiring], [3, true]);
  assert.deepEqual([edge.daysToExpiry, edge.expiring], [5, true]);
  assert.equal(later.expiring, false);
  assert.deepEqual([past.expiring, past.pastValidity], [false, true]);
  assert.equal(approved.expiring, false, "an approved quotation has had its answer");
});

test("the summary has every BRD status, zeros included, and averages days in status", () => {
  const rows = buildQuotationRows(
    [
      q({ id: "a", status: "New", value: 1000, statusChangedAt: at("2026-10-11") }),
      q({ id: "b", status: "New", value: 500.5, statusChangedAt: at("2026-10-19") }),
      q({ id: "c", status: "Mystery", value: 10 }),
    ],
    options,
  );
  const summary = summariseByStatus(rows, LIMITS);
  assert.equal(summary.length, 8);
  const notSent = summary.find((s) => s.key === "notSent")!;
  assert.deepEqual(
    [notSent.count, notSent.value, notSent.averageDays, notSent.breached, notSent.ageingLimit],
    [2, 1500.5, 6, 1, 7],
  );
  assert.deepEqual(
    summary.find((s) => s.key === "sent"),
    { key: "sent", label: "Sent", open: true, count: 0, value: 0, averageDays: null, ageingLimit: 10, breached: 0, expiring: 0 },
  );
  assert.equal(summary.at(-1)!.key, "other:Mystery");
});

test("filters: created range, owner, client, value band, status, flags, search", () => {
  const rows = buildQuotationRows(
    [
      q({ id: "a", number: "17001", status: "Sent", value: 4_999, createdAt: at("2026-10-02"), statusChangedAt: at("2026-10-02") }),
      q({ id: "b", number: "17002", status: "New", value: 25_000, clientName: "Client B", createdAt: at("2026-10-15"), statusChangedAt: at("2026-10-15") }),
      q({ id: "c", number: "17003", status: "Expired", value: 60_000, ownerName: "Owner Two", createdAt: at("2026-09-01") }),
    ],
    options,
  );
  const ids = (f: Parameters<typeof filterQuotations>[1]) => filterQuotations(rows, f).map((r) => r.id);
  assert.deepEqual(ids({ from: "2026-10-01", to: "2026-10-31" }), ["a", "b"]);
  assert.deepEqual(ids({ owner: "Owner Two" }), ["c"]);
  assert.deepEqual(ids({ client: "Client B" }), ["b"]);
  assert.deepEqual(ids({ band: "20k_50k" }), ["b"]);
  assert.deepEqual(ids({ status: "open" }), ["a", "b"]);
  assert.deepEqual(ids({ status: "expired" }), ["c"]);
  assert.deepEqual(ids({ flag: "breached" }), ["a"]);
  assert.deepEqual(ids({ q: "17002" }), ["b"]);
  assert.equal(filterQuotations(rows, { status: "expired" }, { ignoreStatus: true }).length, 3);
  assert.equal(valueBandOf(5_000), "5k_20k");
  assert.deepEqual(sortQuotationRows(rows).map((r) => r.id), ["a", "b", "c"]);
});
