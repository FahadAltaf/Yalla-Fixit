import { test } from "node:test";
import assert from "node:assert/strict";

import { AMC_CONFIG_DEFAULTS } from "@/lib/amc/config";
import { parseTracker } from "@/lib/amc/tracker-import";
import { importOrder, importTrackerContracts } from "@/lib/server/amc/tracker-import";

/* DEV-486: what the import writes, checked against the tables' own rules, on a database that remembers. */

type Row = Record<string, unknown>;

function memoryDb() {
  const tables = new Map<string, Row[]>();
  let n = 0;
  const rows = (t: string) => tables.get(t) ?? (tables.set(t, []), tables.get(t)!);
  const read = (row: Row, path: string) => (path.includes("->>") ? (row[path.split("->>")[0]] as Row | undefined)?.[path.split("->>")[1]] : row[path]);
  const query = (table: string) => {
    let filters: Array<(r: Row) => boolean> = [];
    let pending: { kind: "insert"; rows: Row[] } | { kind: "update"; patch: Row } | { kind: "delete" } | null = null;
    const api: Record<string, unknown> = {};
    const run = () => {
      const all = rows(table);
      if (pending?.kind === "insert") {
        const made = pending.rows.map((r) => ({ id: `${table}-${++n}`, proposal_number: table === "amc_submissions" ? `AMC-T-${n}` : undefined, ...r }));
        all.push(...made);
        return made;
      }
      const hit = all.filter((r) => filters.every((f) => f(r)));
      if (pending?.kind === "update") hit.forEach((r) => Object.assign(r, (pending as { patch: Row }).patch));
      if (pending?.kind === "delete") tables.set(table, all.filter((r) => !hit.includes(r)));
      return hit;
    };
    for (const m of ["select", "order", "limit"]) api[m] = () => api;
    api.eq = (c: string, v: unknown) => ((filters = [...filters, (r) => read(r, c) === v]), api);
    api.neq = (c: string, v: unknown) => ((filters = [...filters, (r) => read(r, c) !== v]), api);
    api.in = (c: string, v: unknown[]) => ((filters = [...filters, (r) => v.includes(read(r, c))]), api);
    api.is = (c: string, v: unknown) => ((filters = [...filters, (r) => (read(r, c) ?? null) === v]), api);
    api.not = () => api;
    api.ilike = (c: string, v: string) => ((filters = [...filters, (r) => String(read(r, c) ?? "").toLowerCase() === v.replace(/\\/g, "").toLowerCase()]), api);
    api.insert = (r: Row | Row[]) => ((pending = { kind: "insert", rows: Array.isArray(r) ? r : [r] }), api);
    api.update = (p: Row) => ((pending = { kind: "update", patch: p }), api);
    api.delete = () => ((pending = { kind: "delete" }), api);
    api.single = async () => ({ data: run()[0] ?? null, error: null });
    api.maybeSingle = async () => ({ data: run()[0] ?? null, error: null });
    api.then = (resolve: (v: unknown) => void) => resolve({ data: run(), error: null });
    return api;
  };
  return { admin: { from: query, rpc: async () => ({ data: null, error: null }) } as never, tables, rows };
}

const HEAD1 = ["Proposal No.", "Contract Type", "Start Date", "Expiry Date", "Customer ID", "Customer Name", "Mobile", "Email", "Unit No.", "Building", "Community", "Area", "Property Type", "Bedrooms", "AC Units", "AC Service", "", "", "", "Electrical PPM", "Handyman Hrs", "Emergency Call-out", "Total AED (VAT incl.)", "Payment Terms", "Handler"];
const HEAD2 = ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "1st", "2nd", "3rd", "4th", "1st", "", "", "", "", ""];
const row = (c: Record<number, string>) => HEAD1.map((_, i) => c[i] ?? "");
const csv = (...r: string[][]) => [HEAD1, HEAD2, ...r].map((x) => x.map((v) => (/[",]/.test(v) ? `"${v}"` : v)).join(",")).join("\n");
const TODAY = "2026-11-26";

test("the import writes contracts the tables accept: allowances, visits, renewals, no past visit left open, nothing twice", async () => {
  const parsed = parseTracker(
    csv(
      /* Running, quarterly AC (two visits logged so far, 92 days apart); the rest of the term is planned. */
      row({ 0: "15001", 1: "Annual - non-comprehensive", 2: "01-Jul-2026", 3: "30-Jun-2027", 4: "YFI100", 5: "Client A", 7: "a@x.ae", 8: "101", 9: "Tower A", 12: "Apartment", 13: "2 BR", 14: "3", 15: "15-Jul-26", 16: "15-Oct-26", 19: "15-Jul-26", 20: "12", 21: "Unlimited", 22: "4,200.00", 23: "1 payment", 24: "RALPH" }),
      /* The tracker moved the dates on: last year's visits make an earlier term. */
      row({ 1: "Annual - Semi-Comprehensive", 2: "01-Sep-2026", 3: "31-Aug-2027", 4: "YFI200", 5: "Cafe B", 8: "G1", 9: "Gate Village", 12: "Restaurant", 14: "9", 15: "01-Sep-25", 16: "01-Dec-25", 17: "01-Mar-26", 18: "01-Jun-26", 22: "17,000.00" }),
    ),
    TODAY,
  );
  const db = memoryDb();
  const actor = { id: "user-me", label: "Me" };
  let from: number | null = 0;
  while (from !== null) {
    const r = await importTrackerContracts(db.admin, parsed, { from, count: 2, owners: { RALPH: "user-ralph" }, today: TODAY }, actor, AMC_CONFIG_DEFAULTS);
    assert.deepEqual(r.results.filter((x) => x.outcome === "failed"), [], "nothing failed");
    from = r.next;
  }

  const contracts = db.rows("amc_contracts");
  assert.equal(contracts.length, 3, "two rows and one earlier term");
  for (const c of contracts) {
    assert.ok(String(c.end_date) > String(c.start_date));
    assert.ok(c.signed_at && c.signed_by_name, "a signed status needs who and when");
    assert.ok(["active", "expired", "renewed"].includes(String(c.status)));
  }
  const cafe = contracts.filter((c) => c.customer_name === "Cafe B").sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  assert.deepEqual(cafe.map((c) => c.status), ["renewed", "active"]);
  assert.equal(cafe[1].renewed_from_contract_id, cafe[0].id, "the newer term renews the earlier one");

  const subs = db.rows("amc_submissions");
  assert.equal(subs.find((s) => s.customer_id && (s.customer as Row).customerName === "Client A")?.owner_id, "user-ralph", "the handler owns it");
  assert.equal(subs.find((s) => (s.customer as Row).customerName === "Cafe B")?.owner_id, "user-me", "no handler: the importer");

  for (const e of db.rows("amc_contract_entitlements")) {
    if (e.entitlement_type === "visits" || e.entitlement_type === "hours") assert.ok(e.included_quantity !== null && Number(e.used_quantity) <= Number(e.included_quantity), `${e.service_id} used within included`);
    else assert.equal(e.included_quantity, null, `${e.service_id}: unlimited has no quantity`);
  }
  const a = contracts.find((c) => c.customer_name === "Client A")!;
  const aEnts = db.rows("amc_contract_entitlements").filter((e) => e.contract_id === a.id);
  const ac = aEnts.find((e) => e.service_id === "ac-ppm")!;
  assert.deepEqual([ac.frequency, ac.used_quantity, ac.included_quantity], [4, 2, 4], "quarterly from the gap, two of four used");
  assert.equal(aEnts.find((e) => e.service_id === "handyman")?.entitlement_type, "hours");
  assert.equal(aEnts.find((e) => e.service_id === "emergency")?.call_out_class, "emergency");

  const visits = db.rows("amc_visits");
  for (const c of contracts) {
    const mine = visits.filter((v) => v.contract_id === c.id);
    assert.equal(new Set(mine.map((v) => v.visit_no)).size, mine.length, "visit numbers unique per contract");
    for (const v of mine) {
      assert.ok(String(v.window_start) <= String(v.window_end) && String(v.cycle_start) <= String(v.cycle_end));
      if (v.status !== "completed") assert.ok(String(v.window_end) >= TODAY, `no past visit left open (${v.target_date})`);
    }
  }
  const lines = db.rows("amc_visit_lines");
  const occ = lines.map((l) => `${l.entitlement_id}#${l.occurrence}`);
  assert.equal(new Set(occ).size, occ.length, "one line per occurrence of a service");
  assert.ok(visits.some((v) => v.contract_id === a.id && v.status === "scheduled"), "the rest of the running term is planned");
  assert.ok(a.ppm_confirmed_at, "planned, so its schedule is confirmed and reminders run");
  assert.equal(cafe[0].ppm_confirmed_at, undefined, "an ended term has no planned visits");
  assert.equal(visits.filter((v) => v.contract_id === cafe[0].id && v.status === "completed").length, 4);

  /* Run again: everything is skipped, nothing is written twice. */
  const again = await importTrackerContracts(db.admin, parsed, { from: 0, count: 10, owners: {}, today: TODAY }, actor, AMC_CONFIG_DEFAULTS);
  assert.ok(again.results.every((r) => r.outcome === "skipped"));
  assert.equal(db.rows("amc_contracts").length, 3);
  assert.equal(importOrder(parsed).length, 3);
});
