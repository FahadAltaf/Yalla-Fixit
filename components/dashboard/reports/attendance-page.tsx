"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, Info, Users } from "lucide-react";
import { toast } from "sonner";

import { PageHeading, PillTabs, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ErrorState, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import {
  ATTENDANCE_DAY_COLUMNS,
  ATTENDANCE_DAY_EXPORT_COLUMNS,
  ATTENDANCE_SUMMARY_COLUMNS,
  ATTENDANCE_SUMMARY_EXPORT_COLUMNS,
  attendanceDayExportRow,
  attendanceSummaryExportRow,
} from "@/components/data-table/columns/column-compliance";
import { ReportToolbar, type ReportSelect } from "@/components/data-table/toolbars/report-toolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useDebounce } from "@/hooks/use-debounce";
import type { AttendanceReport } from "@/lib/server/reports/compliance";
import { exportFilename, exportTable, type ExportFormat } from "@/lib/snagging/export-table";
import { reportsService } from "@/modules/reports/reports-service";

import { DataAsOf, SavedFiltersMenu, plural, useReportFilters } from "./shared";

/**
 * Daily attendance (BRD 5.2 B5; DEV-451): per technician per day, the
 * shift, check-in and check-out, hours present, late / early / absent and
 * the leave type, with the monthly summary for HR.
 *
 * Until FSM's shift check-ins can be read (B-01) the flags are not worked
 * out, and the page says so rather than showing everybody absent. What it
 * shows meanwhile is the roster (shift, leave, holiday, rest day) and the
 * day's work in FSM: first job start and last job end, which is evidence
 * of attendance but not a check-in.
 */

type View = "days" | "summary";
type Report = AttendanceReport & { can: { view: boolean; export: boolean } };

const DEFAULTS = { view: "days", from: "", to: "", technician: "", team: "", status: "", q: "" };

export function AttendancePage() {
  const { filters, setFilters, ready, saved, saveAs, remove, apply } = useReportFilters("attendance", DEFAULTS);
  const view: View = filters.view === "summary" ? "summary" : "days";
  const debouncedQ = useDebounce(filters.q, 400);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(
    () => ({
      view,
      from: filters.from,
      to: filters.to,
      technician: filters.technician,
      team: filters.team,
      q: debouncedQ,
      ...(view === "days" ? { status: filters.status } : {}),
    }),
    [view, filters, debouncedQ],
  );

  const ticket = useRef(0);
  const viewLogged = useRef(false);
  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const response = await reportsService.attendance(query, { page, pageSize, logView: !viewLogged.current });
      viewLogged.current = true;
      if (mine !== ticket.current) return;
      setData(response);
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the attendance report");
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
  const switchView = (next: View, patch: Record<string, string> = {}) => change({ ...filters, view: next, q: "", ...patch });

  const doExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const all = await reportsService.attendance(query, { exportFormat: format });
      if (all.view === "summary") {
        await exportTable({
          columns: ATTENDANCE_SUMMARY_EXPORT_COLUMNS,
          rows: all.summary.map(attendanceSummaryExportRow),
          filename: exportFilename(["attendance-summary", all.from, all.to]),
          format,
          sheetName: "Summary",
        });
      } else {
        await exportTable({
          columns: ATTENDANCE_DAY_EXPORT_COLUMNS,
          rows: all.days.map(attendanceDayExportRow),
          filename: exportFilename(["attendance", all.from, all.to]),
          format,
          sheetName: "Attendance",
        });
      }
      toast.success(`Exported ${plural(all.total, "row")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export");
    } finally {
      setExporting(false);
    }
  };

  const selects: ReportSelect[] = [
    { key: "technician", allLabel: "All technicians", options: (data?.options.technicians ?? []).map((t) => ({ value: t.id, label: t.name })) },
    { key: "team", allLabel: "All teams", options: (data?.options.teams ?? []).map((t) => ({ value: t.id, label: t.name })) },
    ...(view === "days"
      ? [
          {
            key: "status",
            allLabel: "Every day",
            options: [
              { value: "working", label: "Shift days" },
              { value: "leave", label: "Leave" },
              { value: "holiday", label: "Public holidays" },
              { value: "rest_day", label: "Rest days" },
              { value: "left", label: "After leaving" },
            ],
            width: "w-full sm:w-40",
          },
        ]
      : []),
  ];

  const toolbar = (
    <ReportToolbar
      key={view}
      idPrefix={`attendance-${view}`}
      searchPlaceholder="Search by technician or team…"
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
      dateLabel="Period"
      clearable={["technician", "team", "status", "from", "to"]}
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

  const overall = data?.overall;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Reports"
        title="Daily attendance"
        description="Per technician per day: the shift, check-in and check-out, late, early and absent, and leave. The monthly summary is the one HR asked for."
        actions={
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
        }
      />

      <PillTabs<View>
        value={view}
        onChange={(next) => switchView(next)}
        tabs={[
          { value: "days", label: "Days" },
          { value: "summary", label: "Monthly summary" },
        ]}
      />

      <div className="flex flex-col gap-1">
        <DataAsOf asOf={data?.dataAsOf ?? null} resources={["appointments"]} />
        {data ? (
          <p className="text-muted-foreground text-xs">
            {data.from} to {data.to}, {plural(data.overall.technicians, "technician")}. Late means checked in more than {data.lateToleranceMinutes} minutes after the shift began.
          </p>
        ) : null}
      </div>

      {data && !data.measured ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Check-ins are not available yet</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>FSM&apos;s shift check-ins and check-outs cannot be read yet (B-01), so nobody is marked late, early or absent: that would only mean the portal cannot see the check-in.</li>
              <li>
                Shown meanwhile: the roster for each day (shift, leave with its type, public holidays, rest days) and the work done in FSM, from the
                first appointment&apos;s actual start to the last one&apos;s end. That is evidence of attendance, not a check-in.
              </li>
              <li>
                {plural(data.notes.leaveRecords, "leave record")} and {plural(data.notes.holidays, "public holiday")} in the period.
                {data.notes.noRestDays ? ` ${plural(data.notes.noRestDays, "technician")} with no rest days set: every day counts as a shift day (D-16).` : ""}
              </li>
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? <ErrorState title="Could not load the attendance report" message={error} onRetry={() => void load()} retrying={loading} /> : null}

      {overall && data ? (
        <StatCardGrid columns={5}>
          <StatCard label="Shift days" value={overall.shiftDays.toLocaleString("en-US")} headline={`Across ${plural(overall.technicians, "technician")}`} caption="Rostered, leave days excluded" />
          <StatCard
            label="Days with work"
            value={overall.jobDays.toLocaleString("en-US")}
            headline={overall.shiftDays ? `${Math.round((overall.jobDays / overall.shiftDays) * 100)}% of shift days` : "No shift days"}
            caption="An appointment with actual times in FSM"
          />
          <StatCard
            label="Leave days"
            value={overall.leaveDays}
            headline="Whole days on leave"
            onSelect={() => switchView("days", { status: "leave" })}
            selectLabel="Show the leave days"
          />
          <StatCard
            label="Late"
            value={data.measured ? overall.lateDays : "—"}
            headline={data.measured ? "Checked in after the tolerance" : "Needs FSM check-ins (B-01)"}
            tone={data.measured && overall.lateDays ? "progress" : "neutral"}
          />
          <StatCard
            label="Absent"
            value={data.measured ? overall.absentDays : "—"}
            headline={data.measured ? "No check-in, no leave" : "Needs FSM check-ins (B-01)"}
            tone={data.measured && overall.absentDays ? "bad" : "neutral"}
          />
        </StatCardGrid>
      ) : (
        <StatGridSkeleton count={5} columns={5} />
      )}

      {view === "summary" ? (
        <Card className="py-0">
          <DataTable
            data={data?.summary ?? []}
            columns={ATTENDANCE_SUMMARY_COLUMNS}
            toolbar={toolbar}
            {...tablePaging}
            handleRowClick={(row) => switchView("days", { technician: row.technicianFsmId })}
            emptyState={<EmptyState icon={<Users />} title="No technicians in this period" description="Nobody was rostered or booked with these filters." />}
          />
        </Card>
      ) : (
        <Card className="py-0">
          <DataTable
            data={data?.days ?? []}
            columns={ATTENDANCE_DAY_COLUMNS}
            toolbar={toolbar}
            {...tablePaging}
            emptyState={<EmptyState icon={<CalendarCheck />} title="No days" description="Nothing matches these filters in this period." />}
          />
        </Card>
      )}
    </div>
  );
}
