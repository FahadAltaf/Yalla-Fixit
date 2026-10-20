/*
  FSM discovery, fifth pass (Finance & Reports, phase 2).

  Settles three facts the sync depends on, recording only key names, types,
  counts and booleans (no values):

    1. Whether the appointment LIST carries `Lead` (the lead technician), so
       the crew detail call can be limited to appointments that need it.
    2. The shape of `$Service_Resources`, where FSM puts an appointment's
       crew on the full record (lib/server/zoho/import-appointments.ts).
    3. Whether a work order's Modified_Time is at or after its newest line
       item's Modified_Time, i.e. whether a line change bumps the work order,
       which an incremental sync by work-order Modified_Time relies on.

  Read-only by construction (createFsmReader); 4–6 GET calls.

  Run:
    FINANCE_FSM_READ=on DISCOVERY_OUT=<path.json> \
      node --env-file=.env --env-file=.env.local --import ./tests/setup/register.mjs \
      scripts/finance/fsm-discovery-crew.ts
*/
import { writeFileSync } from "node:fs";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { createFsmReader, financeFsmReadEnabled } from "@/lib/server/finance/fsm-read";

function keysAndTypes(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 0 ? "array(0)" : [`array(${value.length})`, keysAndTypes(value[0])];
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, typeof (value as Record<string, unknown>)[k]]));
  }
  return value === null || value === undefined ? "null" : typeof value;
}

async function main() {
  if (!financeFsmReadEnabled()) throw new Error("Set FINANCE_FSM_READ=on to run discovery");
  const admin = await createAdminServerClient();
  const token = await getFsmAccessToken(admin);
  const reader = createFsmReader({ token, budget: 8 });
  const out: Record<string, unknown> = { ran_at: new Date().toISOString() };

  // 1 + 2. Appointments: Lead on the list, crew on the full record.
  const list = await reader.get("/Service_Appointments?per_page=100&sort_by=Modified_Time&sort_order=desc");
  const rows = (list.json?.data ?? []) as Record<string, unknown>[];
  const completed = rows.filter((r) => r.Status === "Completed");
  out.appointment_list = {
    status: list.status,
    rows: rows.length,
    with_lead: rows.filter((r) => r.Lead).length,
    lead_shape: keysAndTypes(rows.find((r) => r.Lead)?.Lead),
    with_dollar_resources: rows.filter((r) => Array.isArray(r.$Service_Resources) && (r.$Service_Resources as unknown[]).length > 0).length,
    completed: completed.length,
  };
  const crew: unknown[] = [];
  for (const appt of completed.slice(0, 2)) {
    const detail = await reader.get(`/Service_Appointments/${encodeURIComponent(String(appt.id))}`);
    const row = ((detail.json?.data ?? [])[0] ?? {}) as Record<string, unknown>;
    const resources = row.$Service_Resources as unknown[] | undefined;
    crew.push({
      status: detail.status,
      dollar_resources: keysAndTypes(resources),
      crew_size: Array.isArray(resources) ? resources.length : null,
      has_lead: Boolean(row.Lead),
      lead_in_crew: Boolean(
        row.Lead && Array.isArray(resources) &&
          resources.some((r) => (r as { id?: unknown }).id === (row.Lead as { id?: unknown }).id),
      ),
    });
  }
  out.appointment_details = crew;

  // 3. Does a line change move its work order's Modified_Time?
  const wos = await reader.get("/Work_Orders?per_page=20&sort_by=Modified_Time&sort_order=desc");
  const woRows = ((wos.json?.data ?? []) as Record<string, unknown>[]).filter((w) => w.Status === "In Progress");
  const checks: unknown[] = [];
  for (const wo of woRows.slice(0, 2)) {
    const detail = await reader.get(`/Work_Orders/${encodeURIComponent(String(wo.id))}`);
    const row = ((detail.json?.data ?? [])[0] ?? {}) as Record<string, unknown>;
    const lines = (row.Service_Line_Items ?? []) as Record<string, unknown>[];
    const woTime = Date.parse(String(row.Modified_Time));
    const lineTimes = lines.map((l) => Date.parse(String(l.Modified_Time))).filter(Number.isFinite);
    const newestLine = lineTimes.length ? Math.max(...lineTimes) : null;
    checks.push({
      status: detail.status,
      lines: lines.length,
      line_statuses: [...new Set(lines.map((l) => String(l.Status)))],
      work_order_not_older_than_newest_line: newestLine === null ? null : woTime >= newestLine,
      seconds_line_after_work_order: newestLine === null ? null : Math.max(0, Math.round((newestLine - woTime) / 1000)),
    });
  }
  out.work_order_vs_lines = checks;

  out.calls_used = reader.calls();
  const path = process.env.DISCOVERY_OUT;
  if (!path) throw new Error("Set DISCOVERY_OUT to a file path");
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`wrote ${path} (${reader.calls()} calls)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
