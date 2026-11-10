"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, Gauge, Users, Wrench } from "lucide-react";
import { toast } from "sonner";

import { aed } from "@/components/dashboard/finance/shared";
import { PageHeading, PillTabs, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import {
  COMPLETENESS_EXPORT_COLUMNS,
  MISSING_ACTUALS_COLUMNS,
  MISSING_ACTUALS_EXPORT_COLUMNS,
  UNFLAGGED_EXPORT_COLUMNS,
  completenessExportRow,
  getCompletenessColumns,
  getUnflaggedColumns,
  missingActualsExportRow,
  unflaggedExportRow,
} from "@/components/data-table/columns/column-reports";
import { ReportToolbar, type ReportSelect } from "@/components/data-table/toolbars/report-toolbar";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useDebounce } from "@/hooks/use-debounce";
import type { ActualTimesReport, UnflaggedReport } from "@/lib/server/reports/reports";
import { exportFilename, exportTable, type ExportFormat } from "@/lib/snagging/export-table";
import { todayInZone } from "@/lib/scheduling/org-time";
import { reportsService } from "@/modules/reports/reports-service";

import { HowItWorks, exceptionsHowItWorks } from "./how-it-works";
import { ReportDateRange, SavedFiltersMenu, lastThirtyDays, plural, useReportFilters } from "./shared";

/**
 * Exception reports (BRD 5.2 B5; DEV-453):
 *
 *  - Completed, not flagged: work done on a valued quotation that nobody
 *    has marked Ready to be Invoiced and that is not in the queue. Past the
 *    setting's days it is overdue and its coordinator is told (N13).
 *  - Missing actual times: completed appointments without an actual start
 *    or end, which drop out of job hours; with the data completeness % per
 *    technician and team that sits beside utilization.
 */

type View = "unflagged" | "actual_times";
/* Missing actual times, by team, by technician or the appointments themselves (3 Nov, as on Utilization). */
type By = "team" | "technician" | "appointments";
type Can = { can: { view: boolean; export: boolean } };

const DEFAULTS = { view: "unflagged", by: "team", from: "", to: "", client: "", coordinator: "", technician: "", team: "", overdue: "", q: "" };
/* The page always opens on Completed, not flagged (and By team), whatever tab was used last (3 Nov). */
const NOT_RESTORED = ["view", "by"] as const;

export function ExceptionsPage() {
  const { filters, setFilters, ready, saved, saveAs, remove, apply } = useReportFilters("exceptions", DEFAULTS, { notRestored: NOT_RESTORED });
  const view: View = filters.view === "actual_times" ? "actual_times" : "unflagged";
  const by: By = filters.by === "technician" || filters.by === "appointments" ? filters.by : "team";
  const debouncedQ = useDebounce(filters.q, 400);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  /* The team and technician tables arrive whole, so they page here without asking the server again. */
  const [listPage, setListPage] = useState(0);
  const [data, setData] = useState<((UnflaggedReport | ActualTimesReport) & Can) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  /* Only the filters that apply to the open tab go to the server. */
  const query = useMemo(() => {
    const shared = { view, from: filters.from, to: filters.to, client: filters.client, q: debouncedQ };
    return view === "unflagged"
      ? { ...shared, coordinator: filters.coordinator, overdue: filters.overdue }
      : { ...shared, technician: filters.technician, team: filters.team };
  }, [view, filters, debouncedQ]);

  const ticket = useRef(0);
  const viewLogged = useRef(false);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const response = await reportsService.exceptions(query, { page, pageSize, logView: !viewLogged.current });
      viewLogged.current = true;
      if (mine !== ticket.current) return;
      setData(response);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the exception report");
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [query, page, pageSize]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const change = (next: Record<string, string>) => {
    setFilters({ ...DEFAULTS, ...next });
    setPage(0);
    setListPage(0);
  };
  const switchView = (next: View) => {
    /* Each tab has its own date meaning, so the range starts fresh. */
    setData(null);
    change({ ...filters, view: next, from: "", to: "" });
  };

  const doExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const all = await reportsService.exceptions(query, { exportFormat: format });
      if (all.view === "actual_times" && by !== "appointments") {
        const list = by === "team" ? all.byTeam : all.byTechnician;
        await exportTable({
          columns: COMPLETENESS_EXPORT_COLUMNS,
          rows: list.map(completenessExportRow),
          filename: exportFilename([by === "team" ? "actual-times-by-team" : "actual-times-by-technician", all.from, all.to]),
          format,
          sheetName: by === "team" ? "By team" : "By technician",
        });
        toast.success(`Exported ${plural(list.length, "row")}`);
        return;
      }
      if (all.view === "unflagged") {
        await exportTable({
          columns: UNFLAGGED_EXPORT_COLUMNS,
          rows: all.rows.map(unflaggedExportRow),
          filename: exportFilename(["completed-not-flagged", todayInZone()]),
          format,
          sheetName: "Completed, not flagged",
        });
      } else {
        await exportTable({
          columns: MISSING_ACTUALS_EXPORT_COLUMNS,
          rows: all.rows.map(missingActualsExportRow),
          filename: exportFilename(["missing-actual-times", all.from, all.to]),
          format,
          sheetName: "Missing actual times",
        });
      }
      toast.success(`Exported ${plural(all.total, "row")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export");
    } finally {
      setExporting(false);
    }
  };

  const unflagged = data?.view === "unflagged" ? data : null;
  const actual = data?.view === "actual_times" ? data : null;
  const unflaggedColumns = useMemo(() => getUnflaggedColumns(unflagged?.afterDays ?? 3), [unflagged?.afterDays]);
  const completenessColumns = useMemo(() => getCompletenessColumns(by === "technician" ? "technician" : "team"), [by]);
  const completenessRows = actual ? (by === "team" ? actual.byTeam : actual.byTechnician) : [];

  const selects: ReportSelect[] =
    view === "unflagged"
      ? [
          { key: "client", allLabel: "All clients", options: (unflagged?.options.clients ?? []).map((c) => ({ value: c, label: c })) },
          {
            key: "coordinator",
            allLabel: "All coordinators",
            options: (unflagged?.options.coordinators ?? []).map((c) => ({ value: c, label: c })),
          },
        ]
      : [
          { key: "technician", allLabel: "All technicians", options: (actual?.options.technicians ?? []).map((t) => ({ value: t.id, label: t.name })) },
          { key: "team", allLabel: "All teams", options: (actual?.options.teams ?? []).map((t) => ({ value: t.id, label: t.name })) },
          { key: "client", allLabel: "All clients", options: (actual?.options.clients ?? []).map((c) => ({ value: c, label: c })) },
        ];

  const toolbar = (
    <ReportToolbar
      key={view === "unflagged" ? view : `${view}-${by}`}
      idPrefix={`exceptions-${view}`}
      searchPlaceholder={
        view === "unflagged"
          ? "Search by work order, quotation or client…"
          : by === "appointments"
            ? "Search by appointment, work order, client or technician…"
            : by === "team"
              ? "Search by team…"
              : "Search by technician…"
      }
      initialSearch={filters.q}
      onSearchChange={(q) => {
        setFilters({ ...filters, q });
        setPage(0);
        setListPage(0);
      }}
      loading={loading}
      pageSize={pageSize}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(0);
        setListPage(0);
      }}
      onRefresh={() => void load()}
      filters={filters}
      onFiltersChange={change}
      selects={selects}
      switches={
        view === "unflagged"
          ? [{ key: "overdue", label: "Overdue only", hint: `over ${unflagged?.afterDays ?? 3} days` }]
          : []
      }
      clearable={view === "unflagged" ? ["client", "coordinator", "overdue"] : ["technician", "team", "client"]}
      canExport={Boolean(data?.can.export)}
      exporting={exporting}
      onExport={(format) => void doExport(format)}
    />
  );

  const tablePaging = {
    onGlobalFilterChange: () => undefined,
    onPageChange: setPage,
    onPageSizeChange: (size: number) => {
      setPageSize(size);
      setPage(0);
    },
    pageSize,
    currentPage: page,
    loading,
    rowCount: data?.total ?? 0,
    isPagination: true,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Reports"
        title="Exception reports"
        description="Gaps in the FSM data that would leak from invoicing or skew utilization."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <HowItWorks content={exceptionsHowItWorks(data && "afterDays" in data ? { afterDays: data.afterDays } : undefined)} />
            <ReportDateRange
              from={filters.from || (data && "from" in data ? data.from : "") || lastThirtyDays().from}
              to={filters.to || (data && "to" in data ? data.to : "") || lastThirtyDays().to}
              onChange={(from, to) => change({ ...filters, from, to })}
            />
            <SavedFiltersMenu saved={saved} current={filters} onApply={(entry) => { apply(entry); setPage(0); }} onSave={saveAs} onRemove={remove} />
          </div>
        }
      />

      <PillTabs<View>
        value={view}
        onChange={switchView}
        tabs={[
          { value: "unflagged", label: "Completed, not flagged" },
          { value: "actual_times", label: "Missing actual times" },
        ]}
      />

      {error ? <ErrorState title="Could not load the exception report" message={error} onRetry={() => void load()} retrying={loading} /> : null}

      {view === "unflagged" ? (
        <>
          {unflagged ? (
            <StatCardGrid columns={3}>
              <StatCard label="Completed, not flagged" value={unflagged.totals.count} headline={aed(unflagged.totals.value)} />
              <StatCard
                label={`Overdue (over ${unflagged.afterDays} days)`}
                value={unflagged.totals.overdue}
                headline={aed(unflagged.totals.overdueValue)}
                tone={unflagged.totals.overdue ? "bad" : "good"}
                onSelect={() => change({ ...filters, overdue: filters.overdue === "1" ? "" : "1" })}
                selectLabel="Show overdue work orders only"
              />
            </StatCardGrid>
          ) : (
            <StatGridSkeleton count={2} columns={3} />
          )}
          <p className="text-muted-foreground text-xs">
            Listed: work orders Completed or Closed in FSM, on a quotation with a value, whose quotation is not marked To Be
            Invoiced and that are not in the invoicing queue.
          </p>
          <Card className="py-0">
            <DataTable
              data={unflagged?.rows ?? []}
              columns={unflaggedColumns}
              toolbar={toolbar}
              {...tablePaging}
              emptyState={
                <EmptyState
                  icon={<ClipboardCheck />}
                  title="Nothing missing its invoice flag"
                  description="Every completed work order with a valued quotation is flagged or already in the invoicing queue."
                />
              }
            />
          </Card>
        </>
      ) : (
        <>
          {actual ? (
            <StatCardGrid columns={3}>
              <StatCard
                label="Data completeness"
                value={actual.overall.completenessPercent === null ? "—" : `${actual.overall.completenessPercent}%`}
                headline={`${actual.overall.withActualTimes} of ${plural(actual.overall.completed, "completed appointment")} have actual times`}
              />
              <StatCard label="Missing actual times" value={actual.cards.missing} headline={`${actual.from} to ${actual.to}`} />
              <StatCard
                label="Least complete technician"
                value={actual.cards.leastComplete?.completenessPercent === undefined ? "—" : `${actual.cards.leastComplete.completenessPercent}%`}
                headline={actual.cards.leastComplete?.name ?? "No completed appointments"}
              />
            </StatCardGrid>
          ) : (
            <StatGridSkeleton count={3} columns={3} />
          )}

          {/* The views sit right above the table they switch, as on Utilization. */}
          <PillTabs<By>
            value={by}
            onChange={(next) => change({ ...filters, by: next, q: "" })}
            tabs={[
              { value: "team", label: "By team" },
              { value: "technician", label: "By technician" },
              { value: "appointments", label: "Appointments" },
            ]}
          />

          {by === "appointments" ? (
            <Card className="py-0">
              <DataTable
                data={actual?.rows ?? []}
                columns={MISSING_ACTUALS_COLUMNS}
                toolbar={toolbar}
                {...tablePaging}
                emptyState={
                  <EmptyState
                    icon={<Wrench />}
                    title="No appointments missing actual times"
                    description="Every completed appointment in this period has an actual start and end."
                  />
                }
              />
            </Card>
          ) : (
            /* Most missing first, as the server sorts them. A team opens its technicians. */
            <Card className="py-0">
              <DataTable
                data={completenessRows.slice(listPage * pageSize, (listPage + 1) * pageSize)}
                columns={completenessColumns}
                toolbar={toolbar}
                {...tablePaging}
                currentPage={listPage}
                onPageChange={setListPage}
                rowCount={completenessRows.length}
                handleRowClick={by === "team" ? (row) => change({ ...filters, by: "technician", team: row.key, q: "" }) : undefined}
                emptyState={
                  <EmptyState
                    icon={by === "team" ? <Users /> : <Gauge />}
                    title={by === "team" ? "No teams in this period" : "No technicians in this period"}
                    description="No completed appointments in these dates match these filters."
                  />
                }
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

