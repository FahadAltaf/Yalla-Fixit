/*
  FSM discovery, second pass (Finance & Reports, phase 0).

  The first pass found the stored OAuth token has no settings scope
  (OAUTH_SCOPE_MISMATCH on /settings/*), so field metadata and the module
  list are closed. This pass learns from the records instead:

    1. Which values Work_Orders.Billing_Status / Status actually take --
       "Ready to be Invoiced" has no field of its own, so it is probably one
       of these values.
    2. How often Service_Appointments carry actual start/end times, which is
       the data-completeness risk behind the utilization report.
    3. Whether trip, timesheet, check-in, rating and report modules answer at
       all, probed by name with a one-record GET.

  Only the listed fields are requested (`fields=`), and only COUNTS of their
  values are kept: no names, contacts, addresses or ids. Read-only by
  construction (createFsmReader).

  Run:
    FINANCE_FSM_READ=on DISCOVERY_OUT=<path.json> \
      node --env-file=.env --import ./tests/setup/register.mjs \
      scripts/finance/fsm-discovery-values.ts
*/
import { writeFileSync } from "node:fs";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { createFsmReader, financeFsmReadEnabled } from "@/lib/server/finance/fsm-read";

const PAGES = 3; // up to 600 recent records per module: a fair sample, 6 calls
const PER_PAGE = 200;

/* Only categorical fields: their values are labels, never personal data. */
const CATEGORICAL: Record<string, string[]> = {
  Work_Orders: ["Status", "Billing_Status", "Type", "Work_Type__C", "PPM_Status__C", "Chargeable__C", "Outside_AMC_Scope__C"],
  Service_Appointments: ["Status", "Billing_Status", "Type", "Schedule_Type"],
};
/* Presence-only: we count how many are filled, never what they hold. */
const PRESENCE: Record<string, string[]> = {
  Work_Orders: ["Completed_Time", "AMC_Contract_Ref__C"],
  Service_Appointments: ["Actual_Start_Date_Time", "Actual_End_Date_Time", "Actual_Duration"],
};

/* Module names worth a probe. A miss is a 4xx on a GET: harmless. */
const PROBES = [
  "Trips", "Trip", "Time_Sheets", "Timesheets", "Time_Sheet",
  "Service_Reports", "Job_Sheets", "Invoices", "Feedbacks", "Ratings",
  "Check_Ins", "Attendance", "User_Availability", "Shifts",
];

function tally(rows: Record<string, unknown>[], field: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const raw = row[field];
    const key = raw === null || raw === undefined || raw === "" ? "(empty)" : String(raw);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

async function readModule(reader: ReturnType<typeof createFsmReader>, moduleName: string) {
  const fields = [...CATEGORICAL[moduleName], ...PRESENCE[moduleName]].join(",");
  const rows: Record<string, unknown>[] = [];
  const statuses: number[] = [];
  for (let page = 1; page <= PAGES; page += 1) {
    const res = await reader.get(
      `/${moduleName}?fields=${encodeURIComponent(fields)}&per_page=${PER_PAGE}&page=${page}&sort_by=Modified_Time&sort_order=desc`,
    );
    statuses.push(res.status);
    const data = (res.json?.data ?? []) as Record<string, unknown>[];
    rows.push(...data);
    if (!res.json?.info?.more_records) break;
  }
  const values: Record<string, Record<string, number>> = {};
  for (const f of CATEGORICAL[moduleName]) values[f] = tally(rows, f);
  const presence: Record<string, string> = {};
  for (const f of PRESENCE[moduleName]) {
    const filled = rows.filter((r) => r[f] !== null && r[f] !== undefined && r[f] !== "").length;
    presence[f] = `${filled}/${rows.length}`;
  }
  return { statuses, sampled: rows.length, values, presence };
}

async function main() {
  if (!financeFsmReadEnabled()) throw new Error("Set FINANCE_FSM_READ=on on the command line for this run.");
  const outPath = process.env.DISCOVERY_OUT;
  if (!outPath) throw new Error("Set DISCOVERY_OUT to a path outside the repo.");

  const token = await getFsmAccessToken(await createAdminServerClient());
  const reader = createFsmReader({ token, budget: 40 });
  const report: Record<string, unknown> = { ran_at: new Date().toISOString() };

  for (const moduleName of Object.keys(CATEGORICAL)) {
    report[moduleName] = await readModule(reader, moduleName);
  }

  const probes: Record<string, unknown> = {};
  for (const name of PROBES) {
    const res = await reader.get(`/${name}?per_page=1&page=1`);
    const first = (res.json?.data ?? [])[0] as Record<string, unknown> | undefined;
    probes[name] = {
      status: res.status,
      code: res.json?.code ?? null,
      // Keys only, and only when the module answered with a record.
      keys: first ? Object.keys(first).sort() : null,
    };
  }
  report.module_probes = probes;
  report.calls_used = reader.calls();

  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`wrote ${outPath} (${reader.calls()} FSM calls, all GET)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
