"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCheck, Gauge, Users, Wrench } from "lucide-react";
import { toast } from "sonner";

import { aed } from "@/components/dashboard/finance/shared";
import { PageHeading, PillTabs, SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import {
  MISSING_ACTUALS_COLUMNS,
  MISSING_ACTUALS_EXPORT_COLUMNS,
  UNFLAGGED_EXPORT_COLUMNS,
  getUnflaggedColumns,
  missingActualsExportRow,
  unflaggedExportRow,
} from "@/components/data-table/columns/column-reports";
import { ReportToolbar, type ReportSelect } from "@/components/data-table/toolbars/report-toolbar";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebounce } from "@/hooks/use-debounce";
import { fsmRecordLink } from "@/lib/fsm-links";
import type { CompletenessRow } from "@/lib/reports/exceptions";
import type { ActualTimesReport, UnflaggedReport } from "@/lib/server/reports/reports";
import { exportFilename, exportTable, type ExportFormat } from "@/lib/snagging/export-table";
import { todayInZone } from "@/lib/scheduling/org-time";
import { reportsService } from "@/modules/reports/reports-service";

import { DataAsOf, SavedFiltersMenu, plural, useReportFilters } from "./shared";

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
type Can = { can: { view: boolean; export: boolean } };

const DEFAULTS = { view: "unflagged", from: "", to: "", client: "", coordinator: "", technician: "", team: "", overdue: "", q: "" };

export function ExceptionsPage() {
  const { filters, setFilters, ready, saved, saveAs, remove, apply } = useReportFilters("exceptions", DEFAULTS);
  const view: View = filters.view === "actual_times" ? "actual_times" : "unflagged";
  const debouncedQ = useDebounce(filters.q, 400);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
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
      key={view}
      idPrefix={`exceptions-${view}`}
      searchPlaceholder={view === "unflagged" ? "Search by work order, quotation or client…" : "Search by appointment, work order, client or technician…"}
      initialSearch={filters.q}
      onSearchChange={(q) => {
        setFilters({ ...filters, q });
        setPage(0);
      }}
      loading={loading}
      pageSize={pageSize}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(0);
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
      dateLabel={view === "unflagged" ? "Completed" : "Scheduled"}
      clearable={view === "unflagged" ? ["client", "coordinator", "overdue", "from", "to"] : ["technician", "team", "client", "from", "to"]}
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
        description="Lists that protect the invoicing queue and the utilization figures from gaps in the FSM data."
        actions={<SavedFiltersMenu saved={saved} current={filters} onApply={(entry) => { apply(entry); setPage(0); }} onSave={saveAs} onRemove={remove} />}
      />

      <PillTabs<View>
        value={view}
        onChange={switchView}
        tabs={[
          { value: "unflagged", label: "Completed, not flagged" },
          { value: "actual_times", label: "Missing actual times" },
        ]}
      />

      <DataAsOf asOf={data?.dataAsOf ?? null} resources={view === "unflagged" ? ["work_orders", "estimates"] : ["appointments"]} />

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
            Invoiced and that are not in the invoicing queue. What counts as completed and which field is the flag are still to
            confirm (D-01, D-02).
          </p>
          <Card className="py-0">
            <DataTable
              data={unflagged?.rows ?? []}
              columns={unflaggedColumns}
              toolbar={toolbar}
              {...tablePaging}
              handleRowClick={(row) => {
                const link = fsmRecordLink("Work_Orders", row.workOrderId);
                if (link) window.open(link, "_blank", "noopener,noreferrer");
              }}
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
              <StatCard label="Missing actual times" value={actual.total} headline={`${actual.from} to ${actual.to}`} />
              <StatCard
                label="Least complete technician"
                value={actual.byTechnician[0]?.completenessPercent === undefined ? "—" : `${actual.byTechnician[0].completenessPercent}%`}
                headline={actual.byTechnician[0]?.name ?? "No completed appointments"}
              />
            </StatCardGrid>
          ) : (
            <StatGridSkeleton count={3} columns={3} />
          )}

          {actual && actual.overall.completed > 0 ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <CompletenessTable icon={<Users />} title="By team" rows={actual.byTeam} />
              <CompletenessTable icon={<Gauge />} title="By technician (least complete first)" rows={actual.byTechnician.slice(0, 12)} />
            </div>
          ) : null}

          <Card className="py-0">
            <DataTable
              data={actual?.rows ?? []}
              columns={MISSING_ACTUALS_COLUMNS}
              toolbar={toolbar}
              {...tablePaging}
              handleRowClick={(row) => {
                const link = fsmRecordLink("Service_Appointments", row.id);
                if (link) window.open(link, "_blank", "noopener,noreferrer");
              }}
              emptyState={
                <EmptyState
                  icon={<Wrench />}
                  title="No appointments missing actual times"
                  description="Every completed appointment in this period has an actual start and end."
                />
              }
            />
          </Card>
        </>
      )}
    </div>
  );
}

function CompletenessTable({ icon, title, rows }: { icon: React.ReactNode; title: string; rows: CompletenessRow[] }) {
  return (
    <SectionCard icon={icon} title={title} bodyClassName="border-t">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Name</TableHead>
            <TableHead className="text-right">Completed</TableHead>
            <TableHead className="text-right">With times</TableHead>
            <TableHead className="pr-5 text-right">Completeness</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="pl-5">{row.name}</TableCell>
              <TableCell className="text-right tabular-nums">{row.completed}</TableCell>
              <TableCell className="text-right tabular-nums">{row.withActualTimes}</TableCell>
              <TableCell className="pr-5 text-right font-medium tabular-nums">
                {row.completenessPercent === null ? "—" : `${row.completenessPercent}%`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SectionCard>
  );
}
