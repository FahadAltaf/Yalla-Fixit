import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { fetchAllRows, fetchAllRowsById } from "@/lib/server/amc/paging";
import { dashboardFromFigures } from "@/lib/server/amc/contract-operations";
import { isMissingFunction } from "@/lib/server/amc/contracts";

/*
  The AMC database review (6 Oct 2026): paging that never stops at a row
  cap, the dashboard figures from the database, and file-level invariants
  of the migrations that are not yet applied. The behaviour of the SQL
  itself is checked on a local PostgreSQL (docs/amc-migration-safety-report.md).
*/

const ROWS = Array.from({ length: 2345 }, (_, i) => ({ id: `id-${String(i).padStart(5, "0")}` }));

/** A fake PostgREST that silently caps every response at `cap` rows. */
function cappedRange(cap: number) {
  let calls = 0;
  return {
    calls: () => calls,
    page: async (from: number, to: number) => {
      calls += 1;
      return { data: ROWS.slice(from, Math.min(to + 1, from + cap)), error: null };
    },
    byId: async (afterId: string | null, size: number) => {
      calls += 1;
      const start = afterId ? ROWS.findIndex((r) => r.id > afterId) : 0;
      return { data: start < 0 ? [] : ROWS.slice(start, start + Math.min(size, cap)), error: null };
    },
  };
}

test("fetchAllRows reads every row even when the server caps pages below the page size", async () => {
  const api = cappedRange(400);
  const { data, error, truncated } = await fetchAllRows(api.page);
  assert.equal(error, null);
  assert.equal(truncated, false);
  assert.equal(data.length, ROWS.length);
  assert.deepEqual(data.map((r) => r.id), ROWS.map((r) => r.id));
});

test("fetchAllRowsById pages by key and reads every row once", async () => {
  const api = cappedRange(1000);
  const { data, truncated } = await fetchAllRowsById(api.byId);
  assert.equal(truncated, false);
  assert.equal(new Set(data.map((r) => r.id)).size, ROWS.length);
  assert.equal(api.calls(), 4); // 1000 + 1000 + 345 + the empty page
});

test("the paging helpers stop at the safety limit and say so", async () => {
  const a = await fetchAllRows(cappedRange(1000).page, { maxRows: 1500 });
  assert.equal(a.data.length, 1500);
  assert.equal(a.truncated, true);
  const b = await fetchAllRowsById(cappedRange(1000).byId, { maxRows: 1500 });
  assert.equal(b.data.length, 1500);
  assert.equal(b.truncated, true);
});

test("the paging helpers return the error and the rows read so far", async () => {
  let n = 0;
  const { data, error } = await fetchAllRows(async (from, to) =>
    ++n === 2 ? { data: null, error: { code: "57014", message: "timeout" } } : { data: ROWS.slice(from, to + 1), error: null },
  );
  assert.equal(error?.code, "57014");
  assert.equal(data.length, 1000);
});

test("dashboardFromFigures maps the database figures, money from fils", () => {
  const d = dashboardFromFigures({
    inForce: 3,
    pendingActivation: 2,
    expiringSoon: 1,
    expired: 4,
    notStarted: 5,
    cancelled: 6,
    inForceValueFils: 1234567,
    withExhaustedEntitlements: 1,
    usageLast30Days: 9,
    recentUsage: [
      {
        id: "u1",
        contractId: "c1",
        proposalNumber: "AMC-2026-0001",
        customerName: "Villa owner",
        serviceLabel: "AC PPM",
        kind: "consumption",
        quantity: "1.00",
        occurredAt: "2026-10-01T10:00:00+04:00",
      },
    ],
  });
  assert.equal(d.inForceValue, 12345.67);
  assert.equal(d.pendingActivation, 2);
  assert.equal(d.recentUsage[0].quantity, 1);
  assert.equal(d.recentUsage[0].customerName, "Villa owner");
  assert.equal(d.expiringWindowDays, 30);
  assert.deepEqual(dashboardFromFigures({}).recentUsage, []);
});

test("a function missing from the PostgREST schema cache is recognised", () => {
  assert.equal(isMissingFunction({ code: "PGRST202" }), true);
  assert.equal(isMissingFunction({ code: "42883" }), true);
  assert.equal(isMissingFunction({ code: "23505" }), false);
});

/* ------------------------------------------------------------------ */
/* File-level invariants of the unapplied AMC migrations               */
/* ------------------------------------------------------------------ */

const DIR = path.join(process.cwd(), "supabase", "migrations");
const NEW_AMC = readdirSync(DIR)
  .filter((f) => /^20261006\d{6}_.*\.sql$/.test(f))
  .sort();
const sql = (f: string) => readFileSync(path.join(DIR, f), "utf8");
const code = (f: string) =>
  sql(f)
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

test("the AMC migrations of this branch are the five expected, in order", () => {
  assert.deepEqual(NEW_AMC, [
    "20261006100000_active_amc_contracts.sql",
    "20261006110000_active_amc_operations.sql",
    "20261006120000_amc_fsm_integration.sql",
    "20261006130000_amc_business_operations.sql",
    "20261006140000_amc_atomic_activation_and_dashboard.sql",
  ]);
});

test("every new table has RLS on and nothing granted to the API roles", () => {
  for (const f of NEW_AMC) {
    const body = code(f);
    for (const [, table] of body.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)) {
      assert.match(body, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), `${f}: RLS on ${table}`);
      assert.match(body, new RegExp(`REVOKE ALL ON[^;]*public\\.${table}\\b[^;]*FROM anon, authenticated`), `${f}: grants on ${table}`);
    }
  }
});

test("every new function pins its search_path and is revoked from the API roles", () => {
  for (const f of NEW_AMC) {
    const body = code(f);
    for (const m of body.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)[\s\S]*?AS \$\$/g)) {
      assert.match(m[0], /SET search_path = public, pg_temp/, `${f}: search_path of ${m[1]}`);
      assert.doesNotMatch(m[0], /SECURITY DEFINER/, `${f}: ${m[1]} must not be SECURITY DEFINER`);
      assert.match(body, new RegExp(`REVOKE ALL ON FUNCTION public\\.${m[1]}\\([^)]*\\) FROM PUBLIC, anon, authenticated`), `${f}: revoke ${m[1]}`);
    }
  }
});

test("dollar quoting is balanced in every new migration", () => {
  for (const f of NEW_AMC) {
    const count = (code(f).match(/\$\$/g) ?? []).length;
    assert.equal(count % 2, 0, `${f}: unbalanced $$`);
    assert.doesNotMatch(code(f), /^AS \$$/m, `${f}: lone $ where $$ was meant`);
  }
});

test("no history is deleted by cascade, except a draft assessment's items", () => {
  for (const f of NEW_AMC) {
    for (const line of code(f).split("\n").filter((l) => /ON DELETE CASCADE/.test(l))) {
      assert.match(line, /assessment_id uuid NOT NULL REFERENCES public\.amc_assessments\(id\) ON DELETE CASCADE/, `${f}: ${line.trim()}`);
    }
  }
});

test("document numbers never truncate past 9999 (no bare lpad to 4)", () => {
  for (const f of NEW_AMC) {
    assert.doesNotMatch(code(f), /lpad\(nextval\([^)]*\)::text, 4/, `${f}: lpad would cut 10000 to 1000`);
  }
});

test("the redundant non-unique renewal index is gone; the unique one is created with the column", () => {
  const contracts = code("20261006100000_active_amc_contracts.sql");
  assert.doesNotMatch(contracts, /CREATE INDEX IF NOT EXISTS idx_amc_submissions_renewal_of/);
  assert.match(contracts, /CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_submissions_one_renewal/);
});

test("nothing in the new AMC migrations drops, renames or narrows what main uses", () => {
  for (const f of NEW_AMC) {
    const body = code(f);
    assert.doesNotMatch(body, /DROP TABLE|DROP COLUMN|RENAME (COLUMN|TO)|ALTER COLUMN \w+ (SET NOT NULL|TYPE)/i, f);
    assert.doesNotMatch(body, /ALTER TABLE public\.amc_submissions\s+(DROP|ALTER|RENAME)/i, f);
  }
});
