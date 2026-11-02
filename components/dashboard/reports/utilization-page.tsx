"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Users, Wrench } from "lucide-react";
import { toast } from "sonner";

import { PageHeading, PillTabs, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import {
  COLUMN_HELP,
  Explained,
  TECHNICIAN_UTILIZATION_COLUMNS,
  TECHNICIAN_UTILIZATION_EXPORT_COLUMNS,
  UTILIZATION_APPOINTMENT_COLUMNS,
  UTILIZATION_APPOINTMENT_EXPORT_COLUMNS,
  hrs,
  pct,
  technicianUtilizationExportRow,
  travelShare,
  utilizationAppointmentExportRow,
} from "@/components/data-table/columns/column-utilization";
import { ReportToolbar, type ReportSelect } from "@/components/data-table/toolbars/report-toolbar";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebounce } from "@/hooks/use-debounce";
import { fsmRecordLink } from "@/lib/fsm-links";
import { CHARGEABILITY_LABELS, type TeamUtilization } from "@/lib/reports/utilization";
import type { UtilizationReport } from "@/lib/server/reports/planning";
import { exportFilename, exportTable, type ExportFormat } from "@/lib/snagging/export-table";
import { reportsService } from "@/modules/reports/reports-service";

import { HowItWorks, utilizationHowItWorks } from "./how-it-works";
import { ReportDateRange, SavedFiltersMenu, lastThirtyDays, plural, useReportFilters } from "./shared";

/**
 * Technician utilization (BRD 5.2 B2; DEV-444; screen in BRD 6.4): time
 * and commercial utilization side by side, per technician and team, with
 * data completeness and the appointments underneath. Travel is
 * a column waiting for FSM trips (B-01).
 */

type View = "technicians" | "teams" | "appointments";
type Can = { can: { view: boolean; export: boolean } };

const DEFAULTS = {
  view: "technicians",
  from: "",
  to: "",
  technician: "",
  team: "",
  client: "",
  chargeability: "",
  missing: "",
  q: "",
};

export function UtilizationPage() {
  const { filters, setFilters, ready, saved, saveAs, remove, apply } = useReportFilters("utilization", DEFAULTS);
  const view: View = filters.view === "teams" || filters.view === "appointments" ? filters.view : "technicians";
  const debouncedQ = useDebounce(filters.q, 400);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<(UtilizationReport & Can) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(() => {
    const shared = {
      view,
      from: filters.from,
      to: filters.to,
      technician: filters.technician,
      team: filters.team,
      client: filters.client,
      q: debouncedQ,
    };
    return view === "appointments" ? { ...shared, chargeability: filters.chargeability, missing: filters.missing } : shared;
  }, [view, filters, debouncedQ]);

  const ticket = useRef(0);
  const viewLogged = useRef(false);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const response = await reportsService.utilization(query, { page, pageSize, logView: !viewLogged.current });
      viewLogged.current = true;
      if (mine !== ticket.current) return;
      setData(response);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the utilization report");
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
  /* The period and the people chosen carry across the tabs. */
  const switchView = (next: View, patch: Record<string, string> = {}) => change({ ...filters, view: next, q: "", ...patch });

  const doExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const all = await reportsService.utilization(query, { exportFormat: format });
      if (all.view === "appointments") {
        await exportTable({
          columns: UTILIZATION_APPOINTMENT_EXPORT_COLUMNS,
          rows: all.appointments.map(utilizationAppointmentExportRow),
          filename: exportFilename(["utilization-appointments", all.from, all.to]),
          format,
          sheetName: "Appointments",
        });
      } else {
        await exportTable({
          columns: TECHNICIAN_UTILIZATION_EXPORT_COLUMNS,
          rows: all.technicians.map(technicianUtilizationExportRow),
          filename: exportFilename(["utilization", all.from, all.to]),
          format,
          sheetName: "Utilization",
        });
      }
      toast.success(`Exported ${plural(all.total, "row")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export");
    } finally {
      setExporting(false);
    }
  };

  const technicianOptions = (data?.options.technicians ?? []).map((t) => ({ value: t.id, label: t.name }));
  const teamOptions = (data?.options.teams ?? []).map((t) => ({ value: t.id, label: t.name }));
  const selects: ReportSelect[] = [
    { key: "technician", allLabel: "All technicians", options: technicianOptions },
    { key: "team", allLabel: "All teams", options: teamOptions },
    { key: "client", allLabel: "All clients", options: (data?.options.clients ?? []).map((c) => ({ value: c, label: c })) },
    ...(view === "appointments"
      ? [
          {
            key: "chargeability",
            allLabel: "Chargeable or not",
            options: (Object.keys(CHARGEABILITY_LABELS) as Array<keyof typeof CHARGEABILITY_LABELS>).map((k) => ({
              value: k,
              label: CHARGEABILITY_LABELS[k],
            })),
          },
        ]
      : []),
  ];

  const toolbar = (
    <ReportToolbar
      key={view}
      idPrefix={`utilization-${view}`}
      searchPlaceholder={view === "appointments" ? "Search by appointment, work order, client or technician…" : "Search by technician or team…"}
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
      switches={view === "appointments" ? [{ key: "missing", label: "Missing actual times only" }] : []}
      clearable={["technician", "team", "client", "chargeability", "missing"]}
      canExport={Boolean(data?.can.export) && view !== "teams"}
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

  const overall = data?.overall;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Reports"
        title="Utilization"
        description="How busy each technician was against the hours expected of them, and how much of that work could be billed."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <HowItWorks content={utilizationHowItWorks(data ? { standardDailyHours: data.notes.standardDailyHours, dataCentreDailyHours: data.notes.dataCentreDailyHours } : undefined)} />
            <ReportDateRange
              from={filters.from || data?.from || lastThirtyDays().from}
              to={filters.to || data?.to || lastThirtyDays().to}
              onChange={(from, to) => change({ ...filters, from, to })}
            />
            <SavedFiltersMenu
              saved={saved}
              current={filters}
              onApply={(entry) => {
                apply(entry);
                setPage(0);
              }}
              onSave={saveAs}
              onRemove={remove}
            />
          </div>
        }
      />

      {error ? <ErrorState title="Could not load the utilization report" message={error} onRetry={() => void load()} retrying={loading} /> : null}

      {overall ? (
        <StatCardGrid columns={5}>
          <StatCard
            label="Time utilization"
            value={pct(overall.timePercent)}
            headline={`${hrs(overall.jobMinutes)} of ${hrs(overall.availableMinutes)} expected`}
          />
          <StatCard
            label="Commercial utilization"
            value={pct(overall.commercialPercent)}
            headline={`${hrs(overall.chargeableMinutes)} chargeable`}
          />
          <StatCard label="Above expected" value={hrs(overall.overtimeMinutes)} headline="Hours beyond each week's expected hours" />
          <StatCard
            label="Data completeness"
            value={pct(overall.completenessPercent)}
            headline={`${overall.withActualTimes} of ${plural(overall.completed, "completed appointment")} have actual times`}
            tone={overall.completenessPercent !== null && overall.completenessPercent < 100 ? "bad" : "neutral"}
            onSelect={() => switchView("appointments", { missing: "1" })}
            selectLabel="Show appointments missing actual times"
          />
          <StatCard
            label="Travel"
            value={data?.travel.trips ? `${Math.round((data.travel.minutes / 60) * 10) / 10} h` : "—"}
            headline={
              data?.travel.trips
                ? `${plural(data.travel.trips, "trip")} · ${pct(travelShare({ travelMinutes: data.travel.minutes, availableMinutes: overall.availableMinutes }))} of expected hours`
                : "No trips logged in FSM in these dates"
            }
          />
        </StatCardGrid>
      ) : (
        <StatGridSkeleton count={5} columns={5} />
      )}

      {/* The views sit right above the table they switch (28 Oct). */}
      <PillTabs<View>
        value={view}
        onChange={(next) => switchView(next)}
        tabs={[
          { value: "technicians", label: "By technician" },
          { value: "teams", label: "By team" },
          { value: "appointments", label: "Appointments" },
        ]}
      />

      {view === "teams" ? (
        <Card className="gap-0 py-0">
          {toolbar}
          <div className="border-t">
            <TeamTable rows={data?.teams ?? []} onSelect={(team) => switchView("technicians", { team: team.key })} />
          </div>
        </Card>
      ) : view === "technicians" ? (
        <Card className="py-0">
          <DataTable
            data={data?.technicians ?? []}
            columns={TECHNICIAN_UTILIZATION_COLUMNS}
            toolbar={toolbar}
            {...tablePaging}
            handleRowClick={(row) => switchView("appointments", { technician: row.fsmId })}
            emptyState={
              <EmptyState
                icon={<Gauge />}
                title="No technicians in this period"
                description="Nobody was expected to work or worked in these dates with these filters."
              />
            }
          />
        </Card>
      ) : (
        <Card className="py-0">
          <DataTable
            data={data?.appointments ?? []}
            columns={UTILIZATION_APPOINTMENT_COLUMNS}
            toolbar={toolbar}
            {...tablePaging}
            handleRowClick={(row) => {
              const link = fsmRecordLink("Service_Appointments", row.id);
              if (link) window.open(link, "_blank", "noopener,noreferrer");
            }}
            emptyState={
              <EmptyState
                icon={<Wrench />}
                title="No appointments"
                description="No completed appointments in this period match these filters."
              />
            }
          />
        </Card>
      )}
    </div>
  );
}

function TeamTable({ rows, onSelect }: { rows: TeamUtilization[]; onSelect: (team: TeamUtilization) => void }) {
  if (!rows.length) {
    return <EmptyState icon={<Users />} title="No teams in this period" description="Nobody was expected to work or worked in these dates." className="py-10" />;
  }
  /* The team's figures are its technicians' added up; hover explains each, as on the technicians table. */
  const head = (label: string, key: keyof typeof COLUMN_HELP) => (
    <Explained help={COLUMN_HELP[key]}>
      <span className="decoration-muted-foreground/60 underline decoration-dotted underline-offset-4">{label}</span>
    </Explained>
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-5">Team</TableHead>
          <TableHead>Technicians</TableHead>
          <TableHead>{head("Expected", "available")}</TableHead>
          <TableHead>{head("Job hours", "job")}</TableHead>
          <TableHead>{head("Time %", "time")}</TableHead>
          <TableHead>{head("Chargeable", "chargeable")}</TableHead>
          <TableHead>{head("Commercial %", "commercial")}</TableHead>
          <TableHead>{head("Above expected", "outside")}</TableHead>
          <TableHead>{head("Travel", "travel")}</TableHead>
          <TableHead className="pr-5">{head("Data complete", "completeness")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const who = plural(row.technicians, "technician");
          return (
            <TableRow key={row.key} className="cursor-pointer" onClick={() => onSelect(row)}>
              <TableCell className="pl-5 font-medium">{row.name}</TableCell>
              <TableCell className="tabular-nums">{row.technicians}</TableCell>
              <TableCell className="tabular-nums">
                <Explained help={{ title: `${hrs(row.availableMinutes)} expected`, lines: [`The expected hours of the team's ${who}, added up, on the days they were in it.`] }}>
                  {hrs(row.availableMinutes)}
                </Explained>
              </TableCell>
              <TableCell className="tabular-nums">
                <Explained help={{ title: `${hrs(row.jobMinutes)} of job time inside the shift`, lines: [`The job hours of the team's ${who}, added up.`] }}>
                  {hrs(row.jobMinutes)}
                </Explained>
              </TableCell>
              <TableCell className="font-medium tabular-nums">
                <Explained
                  help={{ title: `Time utilization ${pct(row.timePercent)}`, lines: [`${hrs(row.jobMinutes)} job ÷ ${hrs(row.availableMinutes)} expected = ${pct(row.timePercent)}`] }}
                >
                  {pct(row.timePercent)}
                </Explained>
              </TableCell>
              <TableCell className="tabular-nums">
                <Explained
                  help={{
                    title: `${hrs(row.chargeableMinutes)} chargeable`,
                    lines: [
                      `Of the ${hrs(row.jobMinutes)} job hours, ${hrs(row.chargeableMinutes)} were on work with a value in FSM.`,
                      `${hrs(Math.max(0, row.jobMinutes - row.chargeableMinutes))} were time only.`,
                    ],
                  }}
                >
                  {hrs(row.chargeableMinutes)}
                </Explained>
              </TableCell>
              <TableCell className="font-medium tabular-nums">
                <Explained
                  help={{
                    title: `Commercial utilization ${pct(row.commercialPercent)}`,
                    lines: [`${hrs(row.chargeableMinutes)} chargeable ÷ ${hrs(row.availableMinutes)} expected = ${pct(row.commercialPercent)}`],
                  }}
                >
                  {pct(row.commercialPercent)}
                </Explained>
              </TableCell>
              <TableCell className="tabular-nums">
                {row.overtimeMinutes ? (
                  <Explained help={{ title: `${hrs(row.overtimeMinutes)} above expected`, lines: [`The hours above expected of the team's ${who}, added up, for the weeks they were in it.`] }}>
                    {hrs(row.overtimeMinutes)}
                  </Explained>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="tabular-nums">
                {row.travelTrips ? (
                  <Explained
                    help={{
                      title: `${hrs(row.travelMinutes ?? 0)} travel`,
                      lines: [`${row.travelTrips} trips by the team's ${who} in FSM.`, `${hrs(row.travelMinutes ?? 0)} ÷ ${hrs(row.availableMinutes)} expected = ${pct(travelShare(row))} of the day.`],
                    }}
                  >
                    {hrs(row.travelMinutes ?? 0)} · {pct(travelShare(row))}
                  </Explained>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="pr-5 tabular-nums">
                {row.completenessPercent === null ? (
                  "—"
                ) : (
                  <Explained
                    help={{
                      title: `Data complete ${pct(row.completenessPercent)}`,
                      lines: [`${row.withActualTimes} of ${row.completed} completed appointments have both actual times = ${pct(row.completenessPercent)}`],
                    }}
                  >
                    {pct(row.completenessPercent)}
                  </Explained>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
