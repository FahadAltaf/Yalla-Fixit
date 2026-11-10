import { test } from "node:test";
import assert from "node:assert/strict";

import { ALERT_EVENTS, agedKey, planReportAlerts } from "@/lib/reports/alerts-plan";
import type { UnflaggedRow } from "@/lib/reports/exceptions";
import { buildQuotationRows, type QuotationRecord } from "@/lib/reports/quotations";

const options = { today: "2026-10-21", limits: { notSent: 7, sent: 10, approved: 5 }, expiryWarningDays: 5, timeZone: "Asia/Dubai" };
const q = (patch: Partial<QuotationRecord>): QuotationRecord => ({
  id: "E1",
  number: "17001",
  status: "Sent",
  value: 12_500,
  ownerName: "Owner One",
  ownerEmail: "owner.one@test.local",
  clientName: "Client A",
  createdAt: "2026-10-01T04:00:00Z",
  expiryDate: null,
  statusChangedAt: "2026-10-10T04:00:00Z",
  statusSinceEstimated: false,
  approvedAt: null,
  rejectedAt: null,
  expiredAt: null,
  ...patch,
});
const unflagged = (patch: Partial<UnflaggedRow>): UnflaggedRow => ({
  workOrderId: "W1",
  workOrderNumber: "WO3544",
  quotationId: "E9",
  quotationNumber: "17009",
  clientName: "Client B",
  coordinatorName: "Coordinator One",
  coordinatorEmail: "coord.one@test.local",
  value: 900,
  completedAt: "2026-10-15T08:00:00Z",
  completedDate: "2026-10-15",
  daysSinceCompleted: 6,
  overdue: true,
  ...patch,
});

test("TC07: a quotation 11 days in Sent against 10 raises N7 to the recipients, with the BRD wording", () => {
  const rows = buildQuotationRows([q({})], options);
  const { send } = planReportAlerts({ quotations: rows, unflagged: [], open: [] });
  assert.equal(send.length, 1);
  assert.equal(send[0].event, ALERT_EVENTS.quotationAged);
  assert.equal(send[0].body, "Quotation 17001 (Client A, AED 12,500) in Sent for 11 days, over the 10-day limit.");
  assert.deepEqual(send[0].to, { kind: "recipients", list: "quotations" });
  assert.match(send[0].link, /^\/reports\/quotations\?status=sent&q=17001$/);
});

test("N8 goes to the owner when validity ends within the warning; N13 to the coordinator when overdue only", () => {
  const rows = buildQuotationRows([q({ id: "E2", number: "17002", statusChangedAt: "2026-10-20T04:00:00Z", expiryDate: "2026-10-24" })], options);
  const { send } = planReportAlerts({
    quotations: rows,
    unflagged: [unflagged({}), unflagged({ workOrderId: "W2", overdue: false, daysSinceCompleted: 1 })],
    unflaggedAfterDays: 3,
    open: [],
  });
  assert.deepEqual(
    send.map((s) => [s.event, s.entityId]),
    [
      [ALERT_EVENTS.quotationExpiring, "E2"],
      [ALERT_EVENTS.workOrderUnflagged, "W1"],
    ],
  );
  assert.equal(send[0].body, "Quotation 17002 (Client A) expires in 3 days with no response.");
  assert.deepEqual(send[0].to, { kind: "person", email: "owner.one@test.local", name: "Owner One" });
  assert.equal(send[1].body, "WO3544 for Client B completed 6 days ago, not marked Ready to be Invoiced.");
});

test("only a limit crossed in the last 7 days alerts; older ones are counted as backlog", () => {
  const rows = buildQuotationRows(
    [
      q({ id: "E3", statusChangedAt: "2026-10-03T04:00:00Z" }), // 18 days in Sent: crossed 8 days ago
      q({ id: "E4", statusChangedAt: "2026-10-04T04:00:00Z" }), // 17 days: crossed 7 days ago
    ],
    options,
  );
  const { send, backlog } = planReportAlerts({
    quotations: rows,
    unflagged: [unflagged({ daysSinceCompleted: 11 }), unflagged({ workOrderId: "W3", daysSinceCompleted: 10 })],
    unflaggedAfterDays: 3,
    open: [],
  });
  assert.deepEqual(send.map((s) => s.entityId), ["E4", "W3"]);
  assert.deepEqual(backlog, { quotationsAged: 1, workOrdersUnflagged: 1 });

  /* An alert sent while it was recent stays open while still overdue. */
  const open = [{ event: ALERT_EVENTS.quotationAged, entityId: "E3", dedupeKey: agedKey(rows[0]) }];
  assert.deepEqual(planReportAlerts({ quotations: rows, unflagged: [], open }).resolve, []);
});

test("an open alert whose key no longer applies is resolved; a current one is kept", () => {
  const [row] = buildQuotationRows([q({})], options);
  const open = [
    { event: ALERT_EVENTS.quotationAged, entityId: "E1", dedupeKey: agedKey(row) },
    /* The quotation moved on from New: its old stretch is over. */
    { event: ALERT_EVENTS.quotationAged, entityId: "E1", dedupeKey: "quote-aged:E1:notSent:2026-09-01T04:00:00Z" },
    { event: ALERT_EVENTS.workOrderUnflagged, entityId: "W7", dedupeKey: "wo-unflagged:W7" },
  ];
  const { resolve } = planReportAlerts({ quotations: [row], unflagged: [], open });
  assert.deepEqual(
    resolve.map((r) => r.dedupeKey),
    ["quote-aged:E1:notSent:2026-09-01T04:00:00Z", "wo-unflagged:W7"],
  );
});

test("N14: once per team and day over-booked; closed when it no longer is", () => {
  const over = [{ date: "2026-10-23", teamKey: "L1", teamName: "Ali's team", bookedMinutes: 1230, availableMinutes: 960 }];
  const { send } = planReportAlerts({ quotations: [], unflagged: [], open: [], overbooked: over });
  assert.equal(send.length, 1);
  assert.equal(send[0].event, ALERT_EVENTS.capacityOverbooked);
  assert.equal(send[0].dedupeKey, "capacity-over:L1:2026-10-23");
  assert.equal(send[0].body, "2026-10-23: Ali's team has 20.5 h booked against 16 h available.");
  assert.deepEqual(send[0].to, { kind: "recipients", list: "capacity" });

  const open = [{ event: ALERT_EVENTS.capacityOverbooked, entityId: "L1:2026-10-23", dedupeKey: "capacity-over:L1:2026-10-23" }];
  assert.equal(planReportAlerts({ quotations: [], unflagged: [], open, overbooked: over }).resolve.length, 0, "still over: stays open");
  assert.equal(planReportAlerts({ quotations: [], unflagged: [], open, overbooked: [] }).resolve.length, 1, "no longer over: closed");
  assert.equal(planReportAlerts({ quotations: [], unflagged: [], open }).resolve.length, 0, "capacity not worked out: left alone");
});
