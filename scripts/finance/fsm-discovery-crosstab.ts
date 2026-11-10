/*
  FSM discovery, third pass (Finance & Reports, phase 0).

  Two questions the second pass raised:

    1. Is Estimates.Post_To_Maher__C the coordinator's "Ready to be
       Invoiced" flag? Work_Orders.Billing_Status was "Not yet Invoiced" on
       all 600 sampled, so the flag is not a value of that field.
    2. How complete are actual start/end times on COMPLETED appointments
       specifically -- the denominator the utilization report's data
       completeness figure will use.

  Categorical values and per-row booleans only; nothing identifying is kept.
  Read-only by construction (createFsmReader).
*/
import { writeFileSync } from "node:fs";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { createFsmReader, financeFsmReadEnabled } from "@/lib/server/finance/fsm-read";

const PAGES = 3;
const PER_PAGE = 200;

async function readAll(reader: ReturnType<typeof createFsmReader>, module: string, fields: string[]) {
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= PAGES; page += 1) {
    const res = await reader.get(
      `/${module}?fields=${encodeURIComponent(fields.join(","))}&per_page=${PER_PAGE}&page=${page}&sort_by=Modified_Time&sort_order=desc`,
    );
    rows.push(...((res.json?.data ?? []) as Record<string, unknown>[]));
    if (!res.json?.info?.more_records) break;
  }
  return rows;
}

const filled = (v: unknown) => v !== null && v !== undefined && v !== "";
const label = (v: unknown) => (filled(v) ? String(v) : "(empty)");

function crosstab(rows: Record<string, unknown>[], a: string, b: (r: Record<string, unknown>) => string) {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const ka = label(r[a]);
    const kb = b(r);
    out[ka] ??= {};
    out[ka][kb] = (out[ka][kb] ?? 0) + 1;
  }
  return out;
}

async function main() {
  if (!financeFsmReadEnabled()) throw new Error("Set FINANCE_FSM_READ=on on the command line for this run.");
  const outPath = process.env.DISCOVERY_OUT;
  if (!outPath) throw new Error("Set DISCOVERY_OUT to a path outside the repo.");

  const token = await getFsmAccessToken(await createAdminServerClient());
  const reader = createFsmReader({ token, budget: 12 });

  const estimates = await readAll(reader, "Estimates", [
    "Status", "Post_To_Maher__C", "Invoice_Number_from_Maher__C", "Quotation_Type__C",
  ]);
  const appointments = await readAll(reader, "Service_Appointments", [
    "Status", "Actual_Start_Date_Time", "Actual_End_Date_Time",
  ]);

  const report = {
    ran_at: new Date().toISOString(),
    estimates: {
      sampled: estimates.length,
      // Post_To_Maher__C against the quotation's status, and whether a MAHER
      // invoice number has been recorded -- never the number itself.
      post_to_maher_by_status: crosstab(estimates, "Status", (r) => `post_to_maher=${label(r.Post_To_Maher__C)}`),
      maher_invoice_recorded_by_post_flag: crosstab(
        estimates,
        "Post_To_Maher__C",
        (r) => (filled(r.Invoice_Number_from_Maher__C) ? "has_maher_invoice_no" : "no_maher_invoice_no"),
      ),
      quotation_type: crosstab(estimates, "Quotation_Type__C", () => "n"),
    },
    appointments: {
      sampled: appointments.length,
      actuals_by_status: crosstab(appointments, "Status", (r) => {
        const s = filled(r.Actual_Start_Date_Time);
        const e = filled(r.Actual_End_Date_Time);
        return s && e ? "start+end" : s ? "start_only" : e ? "end_only" : "neither";
      }),
    },
    calls_used: reader.calls(),
  };

  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`wrote ${outPath} (${reader.calls()} FSM calls, all GET)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
