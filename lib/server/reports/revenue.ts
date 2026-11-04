import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  computeRevenue,
  NO_TECHNICIAN,
  type RevenueClientRow,
  type RevenueMonthRow,
  type RevenueSummary,
  type RevenueTechnicianRow,
  type RevenueWorkOrderRow,
} from "@/lib/reports/revenue";
import { addDaysToDateString } from "@/lib/scheduling/org-time";
import { readTimes } from "@/lib/server/finance/fsm-live";

import { loadRevenueInputs, loadTechnicians, type ReportTechnician } from "./data";
import { lastThirtyDays } from "./reports";

/**
 * The revenue report (BRD 5.2 B5; DEV-454), assembled for its route: load,
 * calculate (lib/reports/revenue.ts), filter, page. The cards follow the
 * dates only (3 Nov, every report): client, technician, team, AMC or not
 * and search narrow the tables.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = z.string().trim().max(200);
const id = z.string().trim().max(80);

/* A year at most: every work order changed since the start is read from FSM. */
const MAX_RANGE_DAYS = 366;

export const revenueFiltersSchema = z.object({
  view: z.enum(["clients", "technicians", "months", "work_orders"]).default("clients"),
  from: DATE.optional(),
  to: DATE.optional(),
  client: text.optional(),
  technician: id.optional(),
  team: id.optional(),
  kind: z.enum(["amc", "one_time"]).optional(),
  q: text.optional(),
});

export type RevenueReport = {
  view: "clients" | "technicians" | "months" | "work_orders";
  from: string;
  to: string;
  /** The dates only, whatever the filters. */
  summary: RevenueSummary;
  /** The open view's rows, paged. */
  clients: RevenueClientRow[];
  technicians: RevenueTechnicianRow[];
  months: RevenueMonthRow[];
  workOrders: RevenueWorkOrderRow[];
  total: number;
  options: { clients: string[]; technicians: Array<{ id: string; name: string }>; teams: Array<{ id: string; name: string }> };
  dataAsOf: Record<string, string | null>;
};

const teamKeyOf = (t: ReportTechnician | undefined) => t?.teamLeaderId ?? "none";

function page<T>(rows: T[], p: { page: number; pageSize: number }, all: boolean): T[] {
  return all ? rows : rows.slice(p.page * p.pageSize, (p.page + 1) * p.pageSize);
}

function period(filters: { from?: string; to?: string }) {
  const { to } = lastThirtyDays(filters);
  let { from } = lastThirtyDays(filters);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) from = addDaysToDateString(to, -(MAX_RANGE_DAYS - 1));
  return { from, to };
}

export async function buildRevenueReport(
  admin: SupabaseClient,
  filters: z.infer<typeof revenueFiltersSchema>,
  paging: { page: number; pageSize: number },
  options: { all?: boolean } = {},
): Promise<RevenueReport> {
  const range = period(filters);
  const [roster, inputs] = await Promise.all([loadTechnicians(admin), loadRevenueInputs(admin, range)]);

  /* Hidden test accounts and FSM users not on the technician list are not credited: their share goes to the rest of the crew, or with nobody left to "Not on the technician list". */
  for (const crew of inputs.crews.values()) crew.technicianIds = crew.technicianIds.filter((t) => roster.has(t));
  for (const r of inputs.ratings) r.technicianIds = r.technicianIds.filter((t) => roster.has(t));

  const teamName = (t: ReportTechnician | undefined) => (t?.teamLeaderId ? `${roster.get(t.teamLeaderId)?.name ?? t.teamLeaderId}'s team` : "No team");
  const technicians = new Map([...roster].map(([key, t]) => [key, { name: t.name, teamName: teamName(t) }]));
  const everything = computeRevenue({ ...inputs, technicians });

  /* The tables: the work orders the filters keep, worked out again so shares and totals stay those of what is shown. */
  const filtered =
    filters.client || filters.kind || filters.technician || filters.team
      ? computeRevenue({
          ...inputs,
          technicians,
          workOrders: inputs.workOrders.filter((w) => {
            if (filters.client && (w.clientName ?? "No client") !== filters.client) return false;
            if (filters.kind && w.amc !== (filters.kind === "amc")) return false;
            const crew = inputs.crews.get(w.id)?.technicianIds ?? [];
            if (filters.technician && !crew.includes(filters.technician)) return false;
            if (filters.team && !crew.some((t) => teamKeyOf(roster.get(t)) === filters.team)) return false;
            return true;
          }),
          ratings: inputs.ratings.filter((r) => {
            if (filters.client && (r.clientName ?? "No client") !== filters.client) return false;
            if (filters.technician && !r.technicianIds.includes(filters.technician)) return false;
            if (filters.team && !r.technicianIds.some((t) => teamKeyOf(roster.get(t)) === filters.team)) return false;
            return true;
          }),
        })
      : everything;

  const needle = (filters.q ?? "").toLowerCase();
  const has = (...values: Array<string | null | undefined>) => !needle || values.some((v) => v?.toLowerCase().includes(needle));
  const inTeam = (key: string) =>
    (!filters.technician || key === filters.technician) && (!filters.team || (key !== NO_TECHNICIAN && teamKeyOf(roster.get(key)) === filters.team));

  const rowsOf = {
    clients: filtered.clients.filter((c) => has(c.name)),
    technicians: filtered.technicians.filter((t) => inTeam(t.key) && has(t.name, t.teamName)),
    months: filtered.months,
    work_orders: filtered.workOrders.filter((w) => has(w.number, w.clientName, ...w.shares.map((s) => s.name))),
  };
  const view = filters.view;
  const open = rowsOf[view];

  const leaders = new Set([...roster.values()].map((t) => t.teamLeaderId).filter((v): v is string => Boolean(v)));
  return {
    view,
    from: range.from,
    to: range.to,
    summary: everything.summary,
    clients: view === "clients" ? page(rowsOf.clients, paging, Boolean(options.all)) : [],
    technicians: view === "technicians" ? page(rowsOf.technicians, paging, Boolean(options.all)) : [],
    months: view === "months" ? page(rowsOf.months, paging, Boolean(options.all)) : [],
    workOrders: view === "work_orders" ? page(rowsOf.work_orders, paging, Boolean(options.all)) : [],
    total: open.length,
    options: {
      clients: everything.clients.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
      technicians: [...roster.values()]
        .filter((t) => t.isActive || everything.technicians.some((r) => r.key === t.fsmId))
        .map((t) => ({ id: t.fsmId, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      teams: [
        ...[...leaders].map((leader) => ({ id: leader, name: `${roster.get(leader)?.name ?? leader}'s team` })).sort((a, b) => a.name.localeCompare(b.name)),
        { id: "none", name: "No team" },
      ],
    },
    dataAsOf: readTimes(["work_orders", "appointments", "time_sheets", "service_reports", "estimates"]),
  };
}
