import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  analyseActualTimes,
  findUnflagged,
  type CompletenessRow,
  type MissingActualsRow,
  type UnflaggedRow,
} from "@/lib/reports/exceptions";
import {
  buildQuotationRows,
  filterQuotations,
  sortQuotationRows,
  summariseByStatus,
  type QuotationRow,
  type StatusSummary,
} from "@/lib/reports/quotations";
import { addDaysToDateString, todayInZone } from "@/lib/scheduling/org-time";
import { readReportingSettings } from "@/lib/server/reporting/settings";

import { loadCompletedAppointments, loadQuotationRecords, loadTechnicians, loadUnflaggedInputs } from "./data";

/**
 * The two P5 reports, assembled for their routes: load, calculate, filter,
 * page. The pure calculations are in lib/reports/*.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = z.string().trim().max(200);

export const pagingSchema = z.object({
  page: z.coerce.number().int().min(0).max(10_000).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Newest FSM data in the copy, per resource, for "data as of". */
export async function dataAsOf(admin: SupabaseClient): Promise<Record<string, string | null>> {
  const { data, error } = await admin.schema("fsm").from("sync_state").select("resource, last_success_at");
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((r) => [String(r.resource), (r.last_success_at as string | null) ?? null]));
}

function page<T>(rows: T[], p: { page: number; pageSize: number }, all: boolean): T[] {
  return all ? rows : rows.slice(p.page * p.pageSize, (p.page + 1) * p.pageSize);
}

const uniqueSorted = (values: Array<string | null>) =>
  [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) => a.localeCompare(b));

// ---------------------------------------------------------------------
// Quotation summary (DEV-442)
// ---------------------------------------------------------------------

export const quotationFiltersSchema = z.object({
  from: DATE.optional(),
  to: DATE.optional(),
  owner: text.optional(),
  client: text.optional(),
  band: z.enum(["under_5k", "5k_20k", "20k_50k", "50k_plus"]).optional(),
  status: z.string().trim().max(80).optional(),
  flag: z.enum(["breached", "expiring", "past_validity"]).optional(),
  q: text.optional(),
});

export type QuotationReport = {
  today: string;
  limits: { notSent: number; sent: number; approved: number };
  expiryWarningDays: number;
  summary: StatusSummary[];
  totals: { count: number; value: number; breached: number; expiring: number; pastValidity: number; estimated: number };
  options: { owners: string[]; clients: string[] };
  rows: QuotationRow[];
  total: number;
  dataAsOf: Record<string, string | null>;
};

export async function buildQuotationReport(
  admin: SupabaseClient,
  filters: z.infer<typeof quotationFiltersSchema>,
  paging: { page: number; pageSize: number },
  options: { all?: boolean } = {},
): Promise<QuotationReport> {
  /* "all" (or nothing) is every status. */
  if (filters.status === "all") filters = { ...filters, status: undefined };
  const [settings, records, asOf] = await Promise.all([
    readReportingSettings(admin),
    loadQuotationRecords(admin),
    dataAsOf(admin),
  ]);
  const today = todayInZone();
  const limits = settings.quotations.ageingDaysByStatus;
  const all = buildQuotationRows(records, { today, limits, expiryWarningDays: settings.quotations.expiryWarningDays });

  /* The status cards show what the other filters leave, so a card can be clicked to drill in. */
  const beforeStatus = filterQuotations(all, filters, { ignoreStatus: true });
  const matching = sortQuotationRows(filterQuotations(all, filters));
  return {
    today,
    limits,
    expiryWarningDays: settings.quotations.expiryWarningDays,
    summary: summariseByStatus(beforeStatus, limits),
    totals: {
      count: matching.length,
      value: Math.round(matching.reduce((s, r) => s + r.value, 0) * 100) / 100,
      breached: matching.filter((r) => r.breached).length,
      expiring: matching.filter((r) => r.expiring).length,
      pastValidity: matching.filter((r) => r.pastValidity).length,
      estimated: matching.filter((r) => !r.statusSinceExact).length,
    },
    options: { owners: uniqueSorted(all.map((r) => r.ownerName)), clients: uniqueSorted(all.map((r) => r.clientName)) },
    rows: page(matching, paging, Boolean(options.all)),
    total: matching.length,
    dataAsOf: asOf,
  };
}

// ---------------------------------------------------------------------
// Exception reports (DEV-453)
// ---------------------------------------------------------------------

export const exceptionFiltersSchema = z.object({
  view: z.enum(["unflagged", "actual_times"]).default("unflagged"),
  from: DATE.optional(),
  to: DATE.optional(),
  client: text.optional(),
  coordinator: text.optional(),
  technician: text.optional(),
  team: text.optional(),
  /** Unflagged: only those past the setting's days. */
  overdue: z.enum(["1", "0"]).optional(),
  q: text.optional(),
});

export type UnflaggedReport = {
  view: "unflagged";
  afterDays: number;
  totals: { count: number; overdue: number; value: number; overdueValue: number };
  options: { clients: string[]; coordinators: string[] };
  rows: UnflaggedRow[];
  total: number;
  dataAsOf: Record<string, string | null>;
};

export type ActualTimesReport = {
  view: "actual_times";
  from: string;
  to: string;
  overall: { completed: number; withActualTimes: number; completenessPercent: number | null };
  byTechnician: CompletenessRow[];
  byTeam: CompletenessRow[];
  options: { clients: string[]; technicians: Array<{ id: string; name: string }>; teams: Array<{ id: string; name: string }> };
  rows: MissingActualsRow[];
  total: number;
  dataAsOf: Record<string, string | null>;
};

export async function buildExceptionReport(
  admin: SupabaseClient,
  filters: z.infer<typeof exceptionFiltersSchema>,
  paging: { page: number; pageSize: number },
  options: { all?: boolean } = {},
): Promise<UnflaggedReport | ActualTimesReport> {
  const today = todayInZone();
  const needle = (filters.q ?? "").toLowerCase();

  if (filters.view === "unflagged") {
    const [settings, inputs, asOf] = await Promise.all([readReportingSettings(admin), loadUnflaggedInputs(admin), dataAsOf(admin)]);
    const afterDays = settings.exceptions.completedWithoutFlagAfterDays;
    const all = findUnflagged({ ...inputs, today, afterDays });
    const matching = all.filter((r) => {
      if (filters.from && (!r.completedDate || r.completedDate < filters.from)) return false;
      if (filters.to && (!r.completedDate || r.completedDate > filters.to)) return false;
      if (filters.client && r.clientName !== filters.client) return false;
      if (filters.coordinator && r.coordinatorName !== filters.coordinator) return false;
      if (filters.overdue === "1" && !r.overdue) return false;
      if (needle && !`${r.workOrderNumber ?? ""} ${r.quotationNumber ?? ""} ${r.clientName ?? ""}`.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
    const sum = (rows: UnflaggedRow[]) => Math.round(rows.reduce((s, r) => s + r.value, 0) * 100) / 100;
    const overdue = matching.filter((r) => r.overdue);
    return {
      view: "unflagged",
      afterDays,
      totals: { count: matching.length, overdue: overdue.length, value: sum(matching), overdueValue: sum(overdue) },
      options: { clients: uniqueSorted(all.map((r) => r.clientName)), coordinators: uniqueSorted(all.map((r) => r.coordinatorName)) },
      rows: page(matching, paging, Boolean(options.all)),
      total: matching.length,
      dataAsOf: asOf,
    };
  }

  /* Actual times: a period is needed; the last 30 days unless given. */
  const to = filters.to ?? today;
  const from = filters.from ?? addDaysToDateString(to, -29);
  const [technicians, appointments, asOf] = await Promise.all([
    loadTechnicians(admin),
    loadCompletedAppointments(admin, { from, to }),
    dataAsOf(admin),
  ]);
  const inScope = appointments
    .map((a) => ({ ...a, technicianIds: a.technicianIds.filter((id) => technicians.has(id)) }))
    .filter((a) => {
      if (filters.client && a.clientName !== filters.client) return false;
      if (filters.technician && !a.technicianIds.includes(filters.technician)) return false;
      if (filters.team && !a.technicianIds.some((id) => (technicians.get(id)?.teamLeaderId ?? "none") === filters.team)) return false;
      return true;
    });
  const result = analyseActualTimes({ appointments: inScope, technicians });
  const rows = needle
    ? result.rows.filter((r) =>
        `${r.number ?? ""} ${r.workOrderNumber ?? ""} ${r.clientName ?? ""} ${r.technicianNames.join(" ")}`.toLowerCase().includes(needle),
      )
    : result.rows;

  const leaders = new Set([...technicians.values()].map((t) => t.teamLeaderId).filter((id): id is string => Boolean(id)));
  return {
    view: "actual_times",
    from,
    to,
    overall: result.overall,
    byTechnician: result.byTechnician,
    byTeam: result.byTeam,
    options: {
      clients: uniqueSorted(appointments.map((a) => a.clientName)),
      technicians: [...technicians.values()]
        .filter((t) => t.isActive)
        .map((t) => ({ id: t.fsmId, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      teams: [
        ...[...leaders].map((id) => ({ id, name: `${technicians.get(id)?.name ?? id}'s team` })),
        { id: "none", name: "No team" },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    },
    rows: page(rows, paging, Boolean(options.all)),
    total: rows.length,
    dataAsOf: asOf,
  };
}
