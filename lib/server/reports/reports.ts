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
import { readTimes } from "@/lib/server/finance/fsm-live";
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

/**
 * When Zoho FSM was last read for each kind of record, for "data as of"
 * (26 Oct: the reports read FSM live, kept ten minutes). Called after the
 * report's reads, so it says when what is shown was read.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept so every report calls it the same way
export async function dataAsOf(_admin?: SupabaseClient): Promise<Record<string, string | null>> {
  return readTimes(["appointments", "work_orders", "estimates", "time_sheets", "attendance", "technicians", "time_off"]);
}

/** The dates asked for, or the last 30 days. */
export function lastThirtyDays(filters: { from?: string; to?: string }, today = todayInZone()) {
  let to = filters.to ?? today;
  let from = filters.from ?? addDaysToDateString(to, -29);
  if (from > to) [from, to] = [to, from];
  return { from, to };
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
  /** Created in these dates: the last 30 days unless chosen. */
  from: string;
  to: string;
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
  const period = lastThirtyDays(filters);
  filters = { ...filters, ...period };
  const [settings, records] = await Promise.all([readReportingSettings(admin), loadQuotationRecords(admin)]);
  const asOf = await dataAsOf(admin);
  const today = todayInZone();
  const limits = settings.quotations.ageingDaysByStatus;
  const all = buildQuotationRows(records, { today, limits, expiryWarningDays: settings.quotations.expiryWarningDays });

  /*
    The status cards and the line under them follow the dates only (3 Nov):
    the table's filters (status, owner, client, value, flag, search) narrow
    the list, never the figures above it. A card still drills the list in.
  */
  const inPeriod = filterQuotations(all, { from: period.from, to: period.to });
  const matching = sortQuotationRows(filterQuotations(all, filters));
  return {
    today,
    limits,
    expiryWarningDays: settings.quotations.expiryWarningDays,
    summary: summariseByStatus(inPeriod, limits),
    totals: {
      count: matching.length,
      value: Math.round(matching.reduce((s, r) => s + r.value, 0) * 100) / 100,
      breached: inPeriod.filter((r) => r.breached).length,
      expiring: inPeriod.filter((r) => r.expiring).length,
      pastValidity: inPeriod.filter((r) => r.pastValidity).length,
      estimated: inPeriod.filter((r) => !r.statusSinceExact).length,
    },
    options: { owners: uniqueSorted(all.map((r) => r.ownerName)), clients: uniqueSorted(all.map((r) => r.clientName)) },
    rows: page(matching, paging, Boolean(options.all)),
    total: matching.length,
    from: period.from,
    to: period.to,
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
  /** Completed in these dates: the last 30 days unless chosen. */
  from: string;
  to: string;
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
  /** For the cards: the dates only, whatever the filters. */
  cards: { missing: number; leastComplete: CompletenessRow | null };
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
    const period = lastThirtyDays(filters, today);
    filters = { ...filters, ...period };
    const [settings, inputs] = await Promise.all([readReportingSettings(admin), loadUnflaggedInputs(admin, { from: period.from })]);
    const asOf = await dataAsOf(admin);
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
    /* The cards follow the dates only (3 Nov): client, coordinator, overdue and search narrow the list. */
    const inPeriod = all.filter(
      (r) => (!filters.from || (r.completedDate !== null && r.completedDate >= filters.from)) && (!filters.to || (r.completedDate !== null && r.completedDate <= filters.to)),
    );
    const overdue = inPeriod.filter((r) => r.overdue);
    return {
      view: "unflagged",
      from: period.from,
      to: period.to,
      afterDays,
      totals: { count: inPeriod.length, overdue: overdue.length, value: sum(inPeriod), overdueValue: sum(overdue) },
      options: { clients: uniqueSorted(all.map((r) => r.clientName)), coordinators: uniqueSorted(all.map((r) => r.coordinatorName)) },
      rows: page(matching, paging, Boolean(options.all)),
      total: matching.length,
      dataAsOf: asOf,
    };
  }

  /* Actual times: a period is needed; the last 30 days unless given. */
  const to = filters.to ?? today;
  const from = filters.from ?? addDaysToDateString(to, -29);
  const [technicians, appointments] = await Promise.all([loadTechnicians(admin), loadCompletedAppointments(admin, { from, to })]);
  const asOf = await dataAsOf(admin);
  const inScope = appointments
    .map((a) => ({ ...a, technicianIds: a.technicianIds.filter((id) => technicians.has(id)) }))
    .filter((a) => {
      if (filters.client && a.clientName !== filters.client) return false;
      if (filters.technician && !a.technicianIds.includes(filters.technician)) return false;
      if (filters.team && !a.technicianIds.some((id) => (technicians.get(id)?.teamLeaderId ?? "none") === filters.team)) return false;
      return true;
    });
  const result = analyseActualTimes({ appointments: inScope, technicians });
  /* The cards follow the dates only (3 Nov): every completed appointment in them, whatever the filters. */
  const filtered = Boolean(filters.client || filters.technician || filters.team);
  const forCards = filtered
    ? analyseActualTimes({ appointments: appointments.map((a) => ({ ...a, technicianIds: a.technicianIds.filter((id) => technicians.has(id)) })), technicians })
    : result;
  const rows = needle
    ? result.rows.filter((r) =>
        `${r.number ?? ""} ${r.workOrderNumber ?? ""} ${r.clientName ?? ""} ${r.technicianNames.join(" ")}`.toLowerCase().includes(needle),
      )
    : result.rows;

  /* The team and technician tables follow the team, technician and search too (3 Nov: they are tabs now). */
  const teamOf = (id: string) => technicians.get(id)?.teamLeaderId ?? "none";
  const named = (r: CompletenessRow) => !needle || r.name.toLowerCase().includes(needle);
  const byTechnician = result.byTechnician.filter(
    (r) => (!filters.technician || r.key === filters.technician) && (!filters.team || teamOf(r.key) === filters.team) && named(r),
  );
  const byTeam = result.byTeam.filter(
    (r) => (!filters.team || r.key === filters.team) && (!filters.technician || r.key === teamOf(filters.technician)) && named(r),
  );

  const leaders = new Set([...technicians.values()].map((t) => t.teamLeaderId).filter((id): id is string => Boolean(id)));
  return {
    view: "actual_times",
    from,
    to,
    overall: forCards.overall,
    cards: { missing: forCards.rows.length, leastComplete: forCards.byTechnician[0] ?? null },
    byTechnician,
    byTeam,
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
