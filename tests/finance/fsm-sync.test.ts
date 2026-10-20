import { test } from "node:test";
import assert from "node:assert/strict";

import { createFsmReader } from "@/lib/server/finance/fsm-read";
import { runFsmSync, type SyncOptions } from "@/lib/server/finance/fsm-sync/engine";
import { crewFromDetail, mapAppointment, mapEstimate, mapLineItem, mapWorkOrder } from "@/lib/server/finance/fsm-sync/mappers";
import type { RunStatus, SyncResource, SyncState, SyncStore } from "@/lib/server/finance/fsm-sync/store";

const env = { FINANCE_FSM_READ: "on" } as unknown as NodeJS.ProcessEnv;
type Rec = Record<string, unknown>;

const iso = (minute: number) => new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString();

/* A fake FSM: list pages in either order, detail by id, GET only. */
function fakeFsm(modules: Record<string, Rec[]>, details: Record<string, Rec> = {}, failWith?: number) {
  const paths: string[] = [];
  const fetcher = async (_token: string, path: string, init: RequestInit) => {
    assert.equal(init.method, "GET", "the sync only ever reads");
    paths.push(path);
    if (failWith) return { ok: false, status: failWith, json: { code: "OAUTH_SCOPE_MISMATCH" } };
    const url = new URL(`https://fsm.test${path}`);
    const [, name, id] = url.pathname.split("/");
    if (id) {
      const record = details[id] ?? (modules[name] ?? []).find((r) => r.id === id);
      return record ? { ok: true, status: 200, json: { data: [record] } } : { ok: false, status: 404, json: {} };
    }
    const all = [...(modules[name] ?? [])].sort(
      (a, b) => Date.parse(String(a.Modified_Time)) - Date.parse(String(b.Modified_Time)),
    );
    if (url.searchParams.get("sort_order") === "desc") all.reverse();
    const perPage = Number(url.searchParams.get("per_page"));
    const page = Number(url.searchParams.get("page"));
    const slice = all.slice((page - 1) * perPage, page * perPage);
    if (slice.length === 0) return { ok: true, status: 204, json: null };
    return { ok: true, status: 200, json: { data: slice, info: { more_records: page * perPage < all.length } } };
  };
  return { fetcher, paths };
}

/* The database functions' rules, in memory. */
function memoryStore() {
  const states = new Map<SyncResource, SyncState & { owner: string | null }>(
    (["estimates", "work_orders", "appointments"] as SyncResource[]).map((r) => [
      r,
      { watermark: null, backfillPage: 0, backfillDone: false, backfillStartedAt: null, owner: null },
    ]),
  );
  const tables = {
    estimates: new Map<string, Rec>(),
    work_orders: new Map<string, Rec>(),
    lines: new Map<string, Rec>(),
    appointments: new Map<string, Rec>(),
    crews: new Map<string, string[]>(),
  };
  const runs: { status: RunStatus; error: string | null }[] = [];
  const guarded = (map: Map<string, Rec>, key: string, row: Rec) => {
    const old = map.get(key);
    if (old && Date.parse(String(old.modified_time)) > Date.parse(String(row.modified_time))) return 0;
    map.set(key, { ...row });
    return 1;
  };
  const store: SyncStore = {
    async claim(resource, owner) {
      const s = states.get(resource)!;
      if (s.owner && s.owner !== owner) return false;
      s.owner = owner;
      return true;
    },
    async release(resource, owner, outcome) {
      const s = states.get(resource)!;
      if (s.owner !== owner) return;
      if (outcome.watermark && (!s.watermark || Date.parse(outcome.watermark) > Date.parse(s.watermark))) {
        s.watermark = outcome.watermark;
      }
      if (outcome.backfillPage !== undefined) s.backfillPage = outcome.backfillPage;
      if (outcome.backfillDone !== undefined) s.backfillDone = outcome.backfillDone;
      s.backfillStartedAt = s.backfillStartedAt ?? outcome.backfillStartedAt ?? null;
      s.owner = null;
    },
    async state(resource) {
      const { owner: _owner, ...rest } = states.get(resource)!;
      void _owner;
      return rest;
    },
    async startRun() {
      runs.push({ status: "failed", error: null });
      return String(runs.length);
    },
    async finishRun(id, status, _counts, _wm, error) {
      runs[Number(id) - 1] = { status, error };
    },
    async upsertEstimates(rows) {
      return { written: rows.reduce((n, r) => n + guarded(tables.estimates, r.fsm_estimate_id!, r), 0) };
    },
    async upsertWorkOrders(rows) {
      return { written: rows.reduce((n, r) => n + guarded(tables.work_orders, r.fsm_work_order_id!, r), 0) };
    },
    async syncLineItems(workOrderId, seenAt, rows) {
      for (const r of rows) guarded(tables.lines, r.fsm_line_id!, { ...r, fsm_work_order_id: workOrderId, removed_at: null });
      const present = new Set(rows.map((r) => r.fsm_line_id));
      for (const [id, line] of tables.lines) {
        if (line.fsm_work_order_id === workOrderId && !present.has(id) && !line.removed_at) line.removed_at = seenAt;
      }
      return { written: rows.length };
    },
    async upsertAppointments(rows) {
      return { written: rows.reduce((n, r) => n + guarded(tables.appointments, r.fsm_appointment_id!, r), 0) };
    },
    async setCrew(appointmentId, _seenAt, crew) {
      tables.crews.set(appointmentId, crew.map((c) => `${c.technician_fsm_id}${c.is_lead ? "*" : ""}`).sort());
    },
  };
  return { store, states, tables, runs };
}

const options = (over: Partial<SyncOptions> = {}): Partial<SyncOptions> => ({
  perPage: 2,
  now: () => new Date(iso(1000)),
  ...over,
});

const estimates = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `E${i + 1}`, Name: `Q-${i + 1}`, Status: "New", Modified_Time: iso(from + i) }));

async function sync(resource: SyncResource, kind: "incremental" | "reconcile" | "backfill", fsm: ReturnType<typeof fakeFsm>, mem: ReturnType<typeof memoryStore>, budget = 100, over: Partial<SyncOptions> = {}) {
  const reader = createFsmReader({ token: "t", budget, fetcher: fsm.fetcher, env });
  return runFsmSync({ resource, kind, reader, store: mem.store, options: options(over) });
}

// --- Mappers ---------------------------------------------------------------

test("lookups give their id and name; times become UTC; money stays a number", () => {
  const row = mapEstimate({
    id: "E1", Name: "Q-1042", Status: "Approved", Grand_Total: 1050.5, Post_To_Maher__C: "To Be Invoiced",
    Owner: { id: "U1", name: "Behrouz", email: "b@yfi.ae" }, Company: { id: "C1", name: "Acme", module: "Companies" },
    Work_Order: { id: "W1", name: "WO-1" }, Expiry_Date: "2026-11-01", Modified_Time: "2026-10-20T15:42:42+04:00",
  });
  assert.equal(row.modified_time, "2026-10-20T11:42:42.000Z");
  assert.equal(row.fsm_company_id, "C1");
  assert.equal(row.company_name, "Acme");
  assert.equal(row.owner_email, "b@yfi.ae");
  assert.equal(row.fsm_work_order_id, "W1");
  assert.equal(row.post_to_maher, "To Be Invoiced");
  assert.equal(row.expiry_date, "2026-11-01");
  assert.equal(row.grand_total, 1050.5);
});

test("a line keeps FSM's own id, its service name and its work order's quotation", () => {
  const line = mapLineItem(
    { id: "L1", Name: "LI-1", Service: { id: "S1", name: "Painting" }, Quantity: 2, List_Price: 100,
      Line_Item_Amount: 200, Amount: 190, Tax: { Tax_Percentage: 5 }, Status: "Completed", Sequence: 1,
      Estimate: null, Modified_Time: "2026-10-20T10:00:00Z" },
    "E7",
  );
  assert.deepEqual(
    [line.fsm_line_id, line.name, line.fsm_estimate_id, line.line_amount, line.amount, line.tax_percent, line.status],
    ["L1", "Painting", "E7", 200, 190, 5, "Completed"],
  );
});

test("an actual end before the start is dropped, not stored", () => {
  const a = mapAppointment({ id: "A1", Actual_Start_Date_Time: "2026-10-20T10:00:00Z", Actual_End_Date_Time: "2026-10-20T09:00:00Z", Modified_Time: "2026-10-20T10:00:00Z" });
  assert.equal(a.actual_end, null);
  assert.equal(a.actual_start, "2026-10-20T10:00:00.000Z");
});

test("the crew comes from $Service_Resources, with the lead marked and never missing", () => {
  assert.deepEqual(
    crewFromDetail({ Lead: { id: "T1" }, $Service_Resources: [{ id: "T1" }, { id: "T2" }], Service_Resources: [] }),
    [{ technician_fsm_id: "T1", is_lead: true }, { technician_fsm_id: "T2", is_lead: false }],
  );
  assert.deepEqual(crewFromDetail({ Lead: { id: "T3" } }), [{ technician_fsm_id: "T3", is_lead: true }]);
});

test("work order lookups survive a bare string AMC reference", () => {
  assert.equal(mapWorkOrder({ id: "W1", AMC_Contract_Ref__C: "AMC-9", Modified_Time: iso(1) }).amc_contract_ref, "AMC-9");
});

// --- Engine -----------------------------------------------------------------

test("an incremental run before the backfill refuses and writes nothing", async () => {
  const fsm = fakeFsm({ Estimates: estimates(3) });
  const mem = memoryStore();
  const result = await sync("estimates", "incremental", fsm, mem);
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /backfill/);
  assert.equal(mem.tables.estimates.size, 0);
  assert.equal(fsm.paths.length, 0);
});

test("the backfill reads everything oldest first and ends with the watermark at its start", async () => {
  const fsm = fakeFsm({ Estimates: estimates(5) });
  const mem = memoryStore();
  const result = await sync("estimates", "backfill", fsm, mem);
  assert.equal(result.status, "succeeded");
  assert.equal(mem.tables.estimates.size, 5);
  assert.ok(fsm.paths.every((p) => p.includes("sort_order=asc")));
  const state = mem.states.get("estimates")!;
  assert.equal(state.backfillDone, true);
  assert.equal(state.watermark, iso(1000), "the moment the backfill began");
});

test("a backfill that runs out of budget resumes from its last page, without duplicates", async () => {
  const fsm = fakeFsm({ Estimates: estimates(7) });
  const mem = memoryStore();
  const first = await sync("estimates", "backfill", fsm, mem, 2);
  assert.equal(first.status, "budget_exhausted");
  assert.equal(mem.states.get("estimates")!.backfillPage, 2);
  assert.equal(mem.states.get("estimates")!.watermark, null, "no watermark until it is complete");
  const second = await sync("estimates", "backfill", fsm, mem, 10);
  assert.equal(second.status, "succeeded");
  assert.equal(mem.tables.estimates.size, 7);
  assert.ok(fsm.paths.at(-2)?.includes("page=3"), "carried on from page 3");
});

test("an incremental run reads newest first, stops at the watermark, and advances it", async () => {
  const fsm = fakeFsm({ Estimates: estimates(20) });
  const mem = memoryStore();
  mem.states.get("estimates")!.watermark = iso(18);
  const result = await sync("estimates", "incremental", fsm, mem);
  assert.equal(result.status, "succeeded");
  // Watermark minute 18 less the 10-minute overlap = minute 8: records 8..19,
  // and the page holding minutes 7 and 6 is the last one read.
  assert.equal(result.counts.pages, 7, "stops on the first page that reaches older records");
  assert.equal(mem.tables.estimates.size, 12);
  assert.equal(mem.states.get("estimates")!.watermark, iso(19));
});

test("nothing changed: one list call, watermark kept", async () => {
  const fsm = fakeFsm({ Estimates: estimates(3) });
  const mem = memoryStore();
  mem.states.get("estimates")!.watermark = iso(500);
  const result = await sync("estimates", "incremental", fsm, mem);
  assert.equal(result.status, "succeeded");
  assert.equal(fsm.paths.length, 1);
  assert.equal(mem.states.get("estimates")!.watermark, iso(500));
});

test("a changed work order is read in full: lines stored by their own id; a dropped line is marked removed", async () => {
  const wo = { id: "W1", Name: "WO-1", Status: "In Progress", Estimate: { id: "E1" }, Modified_Time: iso(30) };
  const lines = [
    { id: "L1", Service: { name: "Paint" }, Status: "In Progress", Modified_Time: iso(30) },
    { id: "L2", Service: { name: "Tile" }, Status: "New", Modified_Time: iso(30) },
  ];
  const fsm = fakeFsm({ Work_Orders: [wo] }, { W1: { ...wo, Service_Line_Items: lines } });
  const mem = memoryStore();
  mem.states.get("work_orders")!.watermark = iso(20);
  await sync("work_orders", "incremental", fsm, mem);
  assert.deepEqual([...mem.tables.lines.keys()].sort(), ["L1", "L2"]);
  assert.equal(mem.tables.lines.get("L1")!.fsm_estimate_id, "E1");

  const later = { ...wo, Modified_Time: iso(40) };
  const fsm2 = fakeFsm({ Work_Orders: [later] }, { W1: { ...later, Service_Line_Items: [lines[0]] } });
  await sync("work_orders", "incremental", fsm2, mem);
  assert.ok(mem.tables.lines.get("L2")!.removed_at, "L2 is gone from the work order");
  assert.equal(mem.tables.lines.get("L1")!.removed_at, null);
});

test("a completed appointment brings its crew and re-reads its work order's lines, even when the work order did not move", async () => {
  // The case discovery found: a line completed 336 s after its work order's Modified_Time.
  const appt = { id: "A1", Status: "Completed", Work_Order: { id: "W1" }, Lead: { id: "T1" }, Modified_Time: iso(50) };
  const wo = { id: "W1", Status: "In Progress", Modified_Time: iso(10) };
  const fsm = fakeFsm(
    { Service_Appointments: [appt], Work_Orders: [wo] },
    {
      A1: { ...appt, $Service_Resources: [{ id: "T1" }, { id: "T2" }] },
      W1: { ...wo, Service_Line_Items: [{ id: "L1", Status: "Completed", Modified_Time: iso(56) }] },
    },
  );
  const mem = memoryStore();
  mem.states.get("appointments")!.watermark = iso(45);
  const result = await sync("appointments", "incremental", fsm, mem);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(mem.tables.crews.get("A1"), ["T1*", "T2"]);
  assert.equal(mem.tables.lines.get("L1")!.status, "Completed");
  assert.equal(result.counts.detailCalls, 2);
});

test("a cancelled appointment costs no crew call", async () => {
  const appt = { id: "A1", Status: "Cancelled", Work_Order: null, Lead: { id: "T1" }, Modified_Time: iso(50) };
  const fsm = fakeFsm({ Service_Appointments: [appt] });
  const mem = memoryStore();
  mem.states.get("appointments")!.watermark = iso(45);
  const result = await sync("appointments", "incremental", fsm, mem);
  assert.equal(result.counts.detailCalls, 0);
});

test("out of budget mid-run: the watermark stops at the last record fully done, and the next run finishes", async () => {
  const appts = [1, 2, 3].map((n) => ({ id: `A${n}`, Status: "Completed", Work_Order: { id: `W${n}` }, Lead: { id: "T1" }, Modified_Time: iso(50 + n) }));
  const details = Object.fromEntries(appts.flatMap((a, i) => [
    [a.id, { ...a, $Service_Resources: [{ id: "T1" }] }],
    [`W${i + 1}`, { id: `W${i + 1}`, Modified_Time: iso(1), Service_Line_Items: [] }],
  ]));
  const fsm = fakeFsm({ Service_Appointments: appts }, details);
  const mem = memoryStore();
  mem.states.get("appointments")!.watermark = iso(45);
  // 2 list pages + 2 details for A1 + 1 detail for A2 = 5: A2's work order does not fit.
  const first = await sync("appointments", "incremental", fsm, mem, 5);
  assert.equal(first.status, "budget_exhausted");
  assert.equal(mem.states.get("appointments")!.watermark, iso(51), "only A1 is complete");
  const second = await sync("appointments", "incremental", fsm, mem, 50);
  assert.equal(second.status, "succeeded");
  assert.equal(mem.states.get("appointments")!.watermark, iso(53));
  assert.equal(mem.tables.crews.size, 3);
});

test("a second run while one holds the resource is skipped, not run twice", async () => {
  const fsm = fakeFsm({ Estimates: estimates(2) });
  const mem = memoryStore();
  mem.states.get("estimates")!.owner = "someone-else";
  const result = await sync("estimates", "backfill", fsm, mem);
  assert.equal(result.status, "skipped_busy");
  assert.equal(fsm.paths.length, 0);
});

test("an FSM error fails the run cleanly and keeps the watermark", async () => {
  const fsm = fakeFsm({ Estimates: estimates(2) }, {}, 401);
  const mem = memoryStore();
  mem.states.get("estimates")!.watermark = iso(5);
  const result = await sync("estimates", "incremental", fsm, mem);
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /FSM 401 OAUTH_SCOPE_MISMATCH/);
  assert.equal(mem.states.get("estimates")!.watermark, iso(5));
  assert.equal(mem.states.get("estimates")!.owner, null, "the claim is released");
});

test("a reconcile run re-reads the last days without moving the watermark back", async () => {
  const fsm = fakeFsm({ Estimates: estimates(5) });
  const mem = memoryStore();
  mem.states.get("estimates")!.watermark = iso(900);
  const result = await sync("estimates", "reconcile", fsm, mem);
  assert.equal(result.status, "succeeded");
  assert.equal(mem.tables.estimates.size, 5);
  assert.equal(mem.states.get("estimates")!.watermark, iso(900));
});

test("a reconcile run before the backfill ends never sets the watermark", async () => {
  const fsm = fakeFsm({ Estimates: estimates(3, 990) });
  const mem = memoryStore();
  const result = await sync("estimates", "reconcile", fsm, mem);
  assert.equal(result.status, "succeeded");
  assert.equal(mem.tables.estimates.size, 3);
  assert.equal(mem.states.get("estimates")!.watermark, null, "incremental runs still wait for the backfill");
});
