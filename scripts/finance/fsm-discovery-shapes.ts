/*
  FSM discovery, fourth pass (Finance & Reports, phase 2).

  The list endpoints return Work_Orders.Service_Line_Items and
  Service_Appointments.Service_Resources as empty arrays, and the nested
  lookups (Estimate, Work_Order, Owner) were recorded only as "object". The
  sync's design depends on both: whether line items and technicians need a
  detail call per record, and which keys the lookups carry.

  This records SHAPES only: key names and value types, array lengths, and
  counts. No values, names, ids or amounts are written. Read-only by
  construction (createFsmReader); about 7 GET calls.

  Run:
    FINANCE_FSM_READ=on DISCOVERY_OUT=<path.json> \
      node --env-file=.env --env-file=.env.local --import ./tests/setup/register.mjs \
      scripts/finance/fsm-discovery-shapes.ts
*/
import { writeFileSync } from "node:fs";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { createFsmReader, financeFsmReadEnabled } from "@/lib/server/finance/fsm-read";

type Shape = string | { [key: string]: Shape } | Shape[];

/* Types and keys only, three levels deep; arrays describe their first item. */
function shapeOf(value: unknown, depth = 0): Shape {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return value.length === 0 ? "array(0)" : [`array(${value.length})`, depth < 3 ? shapeOf(value[0], depth + 1) : "…"];
  }
  if (typeof value === "object") {
    if (depth >= 3) return "object";
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, shapeOf((value as Record<string, unknown>)[key], depth + 1)]),
    );
  }
  return typeof value;
}

function pick(row: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, shapeOf(row[key])]));
}

const filled = (rows: Record<string, unknown>[], key: string) =>
  rows.filter((r) => Array.isArray(r[key]) && (r[key] as unknown[]).length > 0).length;

async function main() {
  if (!financeFsmReadEnabled()) throw new Error("Set FINANCE_FSM_READ=on to run discovery");
  const admin = await createAdminServerClient();
  const token = await getFsmAccessToken(admin);
  const reader = createFsmReader({ token, budget: 12 });
  const out: Record<string, unknown> = { ran_at: new Date().toISOString() };

  // 1. Work order list: are line items ever present, and what is Estimate?
  const woList = await reader.get("/Work_Orders?per_page=50&sort_by=Modified_Time&sort_order=desc");
  const wos = (woList.json?.data ?? []) as Record<string, unknown>[];
  out.work_order_list = {
    status: woList.status,
    rows: wos.length,
    with_line_items: filled(wos, "Service_Line_Items"),
    with_appointments: filled(wos, "Service_Appointments"),
    lookups: wos[0] ? pick(wos[0], ["Estimate", "Owner", "Company", "Contact", "Parent_Work_Order", "Service_Appointments"]) : null,
    info_keys: Object.keys(woList.json?.info ?? {}),
  };

  // 2. One work order in full: the line item row shape.
  const target = wos.find((w) => w.Status === "In Progress") ?? wos[0];
  if (target?.id) {
    const detail = await reader.get(`/Work_Orders/${encodeURIComponent(String(target.id))}`);
    const row = ((detail.json?.data ?? [])[0] ?? {}) as Record<string, unknown>;
    out.work_order_detail = {
      status: detail.status,
      line_items: shapeOf(row.Service_Line_Items),
      appointments: shapeOf(row.Service_Appointments),
      estimate: shapeOf(row.Estimate),
      top_level_keys: Object.keys(row).length,
    };
  }

  // 3. Can the list return line items when asked for them by name?
  const woFields = await reader.get("/Work_Orders?fields=Name,Service_Line_Items&per_page=50&sort_by=Modified_Time&sort_order=desc");
  const woFieldRows = (woFields.json?.data ?? []) as Record<string, unknown>[];
  out.work_order_list_with_fields = {
    status: woFields.status,
    rows: woFieldRows.length,
    with_line_items: filled(woFieldRows, "Service_Line_Items"),
    line_item_shape: shapeOf(woFieldRows.find((r) => filled([r], "Service_Line_Items"))?.Service_Line_Items),
  };

  // 4. Appointment list: technicians and the work order lookup.
  const saList = await reader.get("/Service_Appointments?per_page=50&sort_by=Modified_Time&sort_order=desc");
  const sas = (saList.json?.data ?? []) as Record<string, unknown>[];
  out.appointment_list = {
    status: saList.status,
    rows: sas.length,
    with_resources: filled(sas, "Service_Resources"),
    lookups: sas[0] ? pick(sas[0], ["Work_Order", "Duration", "Scheduled_Duration", "Actual_Duration", "Owner"]) : null,
  };

  // 5. One completed appointment in full: the technician shape.
  const sa = sas.find((s) => s.Status === "Completed") ?? sas[0];
  if (sa?.id) {
    const detail = await reader.get(`/Service_Appointments/${encodeURIComponent(String(sa.id))}`);
    const row = ((detail.json?.data ?? [])[0] ?? {}) as Record<string, unknown>;
    out.appointment_detail = {
      status: detail.status,
      resources: shapeOf(row.Service_Resources),
      work_order: shapeOf(row.Work_Order),
      duration: shapeOf(row.Actual_Duration),
    };
  }

  // 6. Appointment list asked for technicians by name.
  const saFields = await reader.get("/Service_Appointments?fields=Name,Service_Resources&per_page=50&sort_by=Modified_Time&sort_order=desc");
  const saFieldRows = (saFields.json?.data ?? []) as Record<string, unknown>[];
  out.appointment_list_with_fields = {
    status: saFields.status,
    rows: saFieldRows.length,
    with_resources: filled(saFieldRows, "Service_Resources"),
  };

  // 7. One quotation linked to a work order: its lookups and any lines.
  const estList = await reader.get("/Estimates?per_page=50&sort_by=Modified_Time&sort_order=desc");
  const ests = (estList.json?.data ?? []) as Record<string, unknown>[];
  const est = ests.find((e) => e.Work_Order) ?? ests[0];
  out.estimate_list = {
    status: estList.status,
    rows: ests.length,
    with_work_order: ests.filter((e) => e.Work_Order).length,
    with_line_items: filled(ests, "Service_Line_Items"),
    lookups: est ? pick(est, ["Work_Order", "Owner", "Company", "Contact", "Parent_Estimate", "Service_Line_Items"]) : null,
  };

  out.calls_used = reader.calls();
  const target_path = process.env.DISCOVERY_OUT;
  if (!target_path) throw new Error("Set DISCOVERY_OUT to a file path");
  writeFileSync(target_path, JSON.stringify(out, null, 2));
  console.log(`wrote ${target_path} (${reader.calls()} calls)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
