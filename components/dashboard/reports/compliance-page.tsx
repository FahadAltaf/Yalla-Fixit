"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, CloudOff, Gavel, Lock, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";

import { PageHeading, PillTabs, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, StatGridSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import { DataTable } from "@/components/data-table";
import {
  COMPLIANCE_EXPORT_COLUMNS,
  complianceColumns,
  complianceDisputeColumns,
  complianceEventColumns,
  complianceExportRow,
  compliancePct,
} from "@/components/data-table/columns/column-compliance";
import { ReportToolbar, type ReportSelect } from "@/components/data-table/toolbars/report-toolbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/use-debounce";
import { EVENT_KIND_LABELS, WAIVER_REASONS, type ComplianceEventKind } from "@/lib/reports/compliance";
import { eventLabel } from "@/lib/reports/compliance-disputes";
import { zonedTimeToUtc } from "@/lib/scheduling/org-time";
import type { ComplianceDisputeRow, ComplianceEventRow, ComplianceReport } from "@/lib/server/reports/compliance";
import { exportFilename, exportTable, type ExportFormat } from "@/lib/snagging/export-table";
import { reportsService } from "@/modules/reports/reports-service";

import { HowItWorks, complianceHowItWorks } from "./how-it-works";
import { SavedFiltersMenu, plural, useReportFilters } from "./shared";

/**
 * App usage compliance (BRD 5.2 B4; DEV-447, 448, 450): per technician,
 * the check-ins owed, performed, missed and waived, compliance against the
 * threshold and the penalty, which is calculated and reported only. Misses
 * can be waived one by one or, for a confirmed outage, for everyone at
 * once. A supervisor or coordinator raises a technician's dispute for
 * them; the named reviewers accept (the miss is waived) or reject it.
 * After the dispute cut-off, with every dispute decided, the month is
 * finalised and frozen, and HR gets the final report (E3).
 *
 * What it can measure today is said at the top: shift check-ins wait on
 * B-01, appointment check-ins on the provisional setting (D-15).
 */

type View = "technicians" | "events" | "disputes";

/*
  The Check-ins tab (one row per check-in owed: waive, raise a dispute).
  False hides it, with the Missed and Waived cards and the technician rows
  that open it (29 Oct: kept, to be reworked).
*/
const CHECK_INS_TAB = true;
type Report = ComplianceReport & { can: { view: boolean; export: boolean; waive: boolean; finalize: boolean; raise: boolean; review: boolean } };

const DEFAULTS = { view: "technicians", month: "", technician: "", team: "", client: "", state: "", dispute: "", q: "" };

const MONTH_NAME = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/* "4,948 shift events": plural with a thousands separator. */
const aed = (value: number) => `AED ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function CompliancePage() {
  const { filters, setFilters, ready, saved, saveAs, remove, apply } = useReportFilters("compliance", DEFAULTS);
  const view: View = (filters.view === "events" && CHECK_INS_TAB) || filters.view === "disputes" ? (filters.view as View) : "technicians";
  const debouncedQ = useDebounce(filters.q, 400);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [waiveOpen, setWaiveOpen] = useState<"selected" | "outage" | null>(null);
  const [disputing, setDisputing] = useState<ComplianceEventRow | null>(null);
  const [deciding, setDeciding] = useState<ComplianceDisputeRow | null>(null);
  const { confirm, dialog } = useConfirm();

  const query = useMemo(
    () => ({
      view,
      month: filters.month,
      technician: filters.technician,
      team: filters.team,
      client: filters.client,
      q: debouncedQ,
      ...(view === "events" ? { state: filters.state } : {}),
      ...(view === "disputes" ? { dispute: filters.dispute } : {}),
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
      const response = await reportsService.compliance(query, { page, pageSize, logView: !viewLogged.current });
      viewLogged.current = true;
      if (mine !== ticket.current) return;
      setData(response);
      setSelected(new Set());
    } catch (e) {
      if (mine !== ticket.current) return;
      setError(e instanceof Error ? e.message : "Could not load the compliance report");
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

  const month = data?.month ?? filters.month;
  const open = data ? data.phase !== "final" && !data.finalized : false;
  const canWaive = Boolean(data?.can.waive) && open && Boolean(data?.storageReady);
  const canRaise = Boolean(data?.can.raise) && open && Boolean(data?.disputesReady);
  /* A dispute raised by the cut-off can be decided until the month is finalised. */
  const canDecide = Boolean(data?.can.review) && Boolean(data && !data.finalized && data.disputesReady);

  const doExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const all = await reportsService.compliance({ ...query, view: "technicians" }, { exportFormat: format });
      await exportTable({
        columns: COMPLIANCE_EXPORT_COLUMNS,
        rows: all.technicians.map(complianceExportRow),
        filename: exportFilename(["compliance", all.month]),
        format,
        sheetName: "Compliance",
      });
      toast.success(`Exported ${plural(all.total, "row")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export");
    } finally {
      setExporting(false);
    }
  };

  const finalize = async () => {
    if (!data) return;
    await confirm({
      title: `Finalise ${MONTH_NAME(data.month)}`,
      description:
        "Every technician's figures are frozen with the settings in force and never recalculated. No waiver or dispute is possible afterwards.",
      confirmText: "Finalise month",
      action: async () => {
        const result = await reportsService.finalizeMonth(data.month);
        toast.success(
          `${plural(result.statements, "statement")} finalised${result.hrReport === "sent" ? "; the report went to HR" : result.hrReport === "no recipients" ? "; no HR recipients are set" : ""}`,
        );
        await load();
      },
    });
  };

  const selects: ReportSelect[] = [
    { key: "technician", allLabel: "All technicians", options: (data?.options.technicians ?? []).map((t) => ({ value: t.id, label: t.name })) },
    { key: "team", allLabel: "All teams", options: (data?.options.teams ?? []).map((t) => ({ value: t.id, label: t.name })) },
    { key: "client", allLabel: "All clients", options: (data?.options.clients ?? []).map((c) => ({ value: c, label: c })) },
    ...(view === "events"
      ? [
          {
            key: "state",
            allLabel: "Missed",
            options: [
              { value: "waived", label: "Waived" },
              { value: "performed", label: "Performed" },
              { value: "all", label: "Every check-in" },
            ],
            width: "w-full sm:w-40",
          },
        ]
      : []),
    ...(view === "disputes"
      ? [
          {
            key: "dispute",
            allLabel: "Every dispute",
            options: [
              { value: "open", label: "To decide" },
              { value: "accepted", label: "Accepted" },
              { value: "rejected", label: "Rejected" },
            ],
            width: "w-full sm:w-40",
          },
        ]
      : []),
  ];

  const toolbar = (
    <ReportToolbar
      key={view}
      idPrefix={`compliance-${view}`}
      searchPlaceholder={
        view === "technicians" ? "Search by technician or team…" : view === "events" ? "Search by technician or appointment…" : "Search by technician, appointment or reason…"
      }
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
      clearable={["technician", "team", "client", "state", "dispute"]}
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

  const eventColumns = useMemo(
    () =>
      complianceEventColumns(
        canWaive
          ? {
              selected,
              toggle: (key) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                }),
            }
          : undefined,
        canRaise ? setDisputing : undefined,
      ),
    [canWaive, canRaise, selected],
  );
  const technicianColumns = useMemo(
    () => complianceColumns(data?.settings ?? { thresholdPercent: null, penaltyPerMissAed: 0, monthlyCapAed: 0 }),
    [data?.settings],
  );
  const disputeColumns = useMemo(() => complianceDisputeColumns(canDecide ? setDeciding : undefined), [canDecide]);

  const overall = data?.overall;
  const thresholdSet = data ? data.settings.thresholdPercent !== null : false;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Reports"
        title="App compliance"
        description="Check-ins owed, done, missed and waived per technician. Penalties are reported only."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <HowItWorks content={complianceHowItWorks(data ? { ...data.settings, cutoffDay: Number(data.cutoffDate.slice(8, 10)) } : undefined)} />
            {/* Compliance is worked out a month at a time (it is finalised and frozen by month). */}
            <Select value={filters.month || data?.month || ""} onValueChange={(month) => change({ ...filters, month })}>
              <SelectTrigger className="h-9 w-44" aria-label="Month">
                <SelectValue placeholder="This month" />
              </SelectTrigger>
              <SelectContent>
                {(data?.options.months ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {data?.can.finalize && data.storageReady && data.phase === "final" && !data.finalized ? (
              <Button variant="outline" onClick={() => void finalize()}>
                <Lock className="size-4" />
                Finalise month
              </Button>
            ) : null}
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

      <div className="flex flex-col gap-1">
        {data ? <p className="text-muted-foreground text-xs">{periodLine(data)}</p> : null}
      </div>

      {error ? <ErrorState title="Could not load the compliance report" message={error} onRetry={() => void load()} retrying={loading} /> : null}

      {overall && data ? (
        <StatCardGrid columns={5}>
          <StatCard
            label="Compliance"
            value={compliancePct(overall.compliancePercent)}
            headline={overall.required ? `${overall.performed} of ${plural(overall.required, "check-in")} performed` : "Nothing measured yet"}
            caption={thresholdSet ? `Threshold ${data.settings.thresholdPercent}%` : "No threshold set"}
          />
          <StatCard
            label="Missed"
            value={overall.missed}
            headline={overall.missed ? "Not recorded and not waived" : "None"}
            tone={overall.missed ? "bad" : "neutral"}
            onSelect={CHECK_INS_TAB ? () => switchView("events", { state: "" }) : undefined}
            selectLabel={CHECK_INS_TAB ? "Show the missed check-ins" : undefined}
          />
          <StatCard
            label="Waived"
            value={overall.waived}
            headline={overall.waived ? "Left out of both counts" : "None waived"}
            onSelect={CHECK_INS_TAB ? () => switchView("events", { state: "waived" }) : undefined}
            selectLabel={CHECK_INS_TAB ? "Show the waived check-ins" : undefined}
          />
          <StatCard
            label="Below threshold"
            value={overall.belowThreshold === null ? "—" : overall.belowThreshold}
            headline={overall.belowThreshold === null ? "Not worked out until the threshold is set" : `Of ${plural(overall.technicians, "technician")}`}
            tone={overall.belowThreshold ? "bad" : "neutral"}
          />
          <StatCard
            label="Penalties"
            value={overall.penaltyPayableAed === null ? "—" : aed(overall.penaltyPayableAed)}
            headline={
              overall.penaltyPayableAed === null
                ? "Not worked out: no threshold set"
                : `AED ${data.settings.penaltyPerMissAed} a miss, capped at AED ${data.settings.monthlyCapAed}`
            }
            caption="For HR to decide; not deducted"
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
          ...(CHECK_INS_TAB ? [{ value: "events" as const, label: "Check-ins" }] : []),
          { value: "disputes", label: overall?.disputesOpen ? `Disputes (${overall.disputesOpen} to decide)` : "Disputes" },
        ]}
      />

      {view === "disputes" ? (
        <Card className="gap-0 py-0">
          {data && !data.disputesReady ? (
            <p className="text-muted-foreground border-b px-4 py-3 text-sm">Disputes are not set up yet: a database update is still to be applied.</p>
          ) : data && !data.can.review && overall?.disputesOpen ? (
            <p className="text-muted-foreground border-b px-4 py-3 text-sm">Only the dispute reviewers named in Settings → Reporting can decide a dispute.</p>
          ) : null}
          <DataTable
            data={data?.disputes ?? []}
            columns={disputeColumns}
            toolbar={toolbar}
            {...tablePaging}
            emptyState={
              <EmptyState
                icon={<Gavel />}
                title="No disputes"
                description="A technician disputes a missed check-in by the cut-off day; a supervisor or coordinator can raise it for them from Check-ins."
              />
            }
          />
        </Card>
      ) : view === "events" ? (
        <Card className="gap-0 py-0">
          {canWaive ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <p className="text-muted-foreground text-sm">
                {selected.size ? `${plural(selected.size, "miss")} selected` : "Tick missed check-ins to waive them, or waive a confirmed outage for everyone."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setWaiveOpen("outage")}>
                  <CloudOff className="size-4" />
                  Waive an outage
                </Button>
                <Button disabled={!selected.size} onClick={() => setWaiveOpen("selected")}>
                  <ShieldCheck className="size-4" />
                  Waive selected
                </Button>
              </div>
            </div>
          ) : null}
          <DataTable
            data={data?.events ?? []}
            columns={eventColumns}
            toolbar={toolbar}
            {...tablePaging}
            emptyState={
              <EmptyState
                icon={<BadgeCheck />}
                title={filters.state ? "Nothing here" : "No missed check-ins"}
                description={
                  data && !data.sources.appointment && !data.sources.shift
                    ? "No check-ins are measured yet: see the note above."
                    : "Nothing matches these filters in this month."
                }
              />
            }
          />
        </Card>
      ) : (
        <Card className="py-0">
          <DataTable
            data={data?.technicians ?? []}
            columns={technicianColumns}
            toolbar={toolbar}
            {...tablePaging}
            handleRowClick={CHECK_INS_TAB ? (row) => switchView("events", { technician: row.fsmId, state: "all" }) : undefined}
            emptyState={
              <EmptyState icon={<Users />} title="No technicians in this month" description="Nobody was rostered or booked with these filters." />
            }
          />
        </Card>
      )}

      {waiveOpen && data ? (
        <WaiveDialog
          mode={waiveOpen}
          month={month}
          count={selected.size}
          onClose={() => setWaiveOpen(null)}
          onSubmit={async (input) => {
            const result = await reportsService.waive({
              month: data.month,
              reason: input.reason,
              note: input.note || null,
              ...(waiveOpen === "selected" ? { eventKeys: [...selected] } : { outage: input.outage! }),
            });
            toast.success(result.waived ? `${plural(result.waived, "miss")} waived` : "Nothing to waive in that window");
            setWaiveOpen(null);
            await load();
          }}
        />
      ) : null}
      {disputing && data ? (
        <RaiseDisputeDialog
          row={disputing}
          cutoffDate={data.cutoffDate}
          onClose={() => setDisputing(null)}
          onSubmit={async (reason) => {
            await reportsService.raiseDispute({ month: data.month, eventKey: disputing.key, reason, onBehalf: true });
            toast.success("Dispute raised; the reviewers are told");
            setDisputing(null);
            await load();
          }}
        />
      ) : null}
      {deciding ? (
        <DecideDisputeDialog
          row={deciding}
          onClose={() => setDeciding(null)}
          onSubmit={async (input) => {
            const result = await reportsService.decideDispute(deciding.id, input);
            toast.success(result.outcome === "accepted" ? "Dispute accepted; the miss is waived" : "Dispute rejected");
            setDeciding(null);
            await load();
          }}
        />
      ) : null}
      {dialog}
    </div>
  );
}

/** A supervisor or coordinator raising a technician's dispute for them (most do not use the portal). */
function RaiseDisputeDialog({
  row,
  cutoffDate,
  onClose,
  onSubmit,
}: {
  row: ComplianceEventRow;
  cutoffDate: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await onSubmit(reason.trim());
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The dispute was not raised");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <ActionDialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>Raise a dispute for {row.technicianName}</DialogTitle>
          <DialogDescription>
            The {eventLabel(row)} on {DAY(row.date)}. The dispute reviewers are told and decide it; accepted, the miss is waived. Disputes for
            this month close on {DAY(cutoffDate)}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="dispute-reason">The technician&apos;s reason</Label>
          <Textarea
            id="dispute-reason"
            rows={4}
            maxLength={2000}
            value={reason}
            placeholder="e.g. The app would not open at the site; told the coordinator by phone."
            onChange={(e) => setReason(e.target.value)}
          />
          {problem ? <p className="text-destructive text-sm">{problem}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} disabled={reason.trim().length < 3} onClick={() => void submit()}>
            Raise dispute
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

/** BRD §6.8: Accept (the event is waived) or Reject (the reason recorded). */
function DecideDisputeDialog({
  row,
  onClose,
  onSubmit,
}: {
  row: ComplianceDisputeRow;
  onClose: () => void;
  onSubmit: (input: { outcome: "accepted" | "rejected"; waiverReason?: string; note?: string }) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<"accepted" | "rejected">("accepted");
  const [waiverReason, setWaiverReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const valid = outcome === "accepted" ? Boolean(waiverReason) : note.trim().length >= 3;
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await onSubmit({ outcome, waiverReason: outcome === "accepted" ? waiverReason : undefined, note: note.trim() || undefined });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Nothing was decided");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <ActionDialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>Decide {row.technicianName}&apos;s dispute</DialogTitle>
          <DialogDescription>
            The {eventLabel(row)} on {DAY(row.date)}. Decided once; who and when are recorded.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="bg-mist rounded-md px-3 py-2 text-sm whitespace-pre-line">{row.reason}</div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={outcome === "accepted" ? "default" : "outline"} onClick={() => setOutcome("accepted")} disabled={busy}>
              Accept and waive
            </Button>
            <Button variant={outcome === "rejected" ? "default" : "outline"} onClick={() => setOutcome("rejected")} disabled={busy}>
              Reject
            </Button>
          </div>
          {outcome === "accepted" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="dispute-waiver-reason">Waived for</Label>
              <Select value={waiverReason} onValueChange={setWaiverReason}>
                <SelectTrigger id="dispute-waiver-reason">
                  <SelectValue placeholder="Choose a reason" />
                </SelectTrigger>
                <SelectContent>
                  {WAIVER_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="dispute-note">{outcome === "rejected" ? "Why it is rejected" : "Note (optional)"}</Label>
            <Textarea id="dispute-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {problem ? <p className="text-destructive text-sm">{problem}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} disabled={!valid} onClick={() => void submit()}>
            {outcome === "accepted" ? "Accept dispute" : "Reject dispute"}
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function periodLine(data: ComplianceReport) {
  const measured = data.to >= data.from ? `measured ${DAY(data.from)} to ${DAY(data.to)}` : "not started";
  const state = data.finalized
    ? `Finalised ${new Date(data.finalized.at).toLocaleDateString("en-GB", { dateStyle: "medium" })}${data.finalized.by ? ` by ${data.finalized.by}` : ""}; read from its statements.`
    : data.phase === "running"
      ? `Running; disputes open until ${DAY(data.cutoffDate)}.`
      : data.phase === "disputes_open"
        ? `Closed; disputes open until ${DAY(data.cutoffDate)}, then it can be finalised.`
        : `Disputes closed on ${DAY(data.cutoffDate)}; not finalised yet.`;
  return `${MONTH_NAME(data.month)}, ${measured}, ${plural(data.overall.technicians, "technician")}. ${state}`;
}

const KINDS: ComplianceEventKind[] = ["shift_check_in", "shift_check_out", "appointment_check_in", "appointment_check_out"];

function WaiveDialog({
  mode,
  month,
  count,
  onClose,
  onSubmit,
}: {
  mode: "selected" | "outage";
  month: string;
  count: number;
  onClose: () => void;
  onSubmit: (input: { reason: string; note: string; outage?: { from: string; to: string; kinds: string[] } }) => Promise<void>;
}) {
  const [reason, setReason] = useState<string>(mode === "outage" ? "App outage" : "");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(`${month}-01`);
  const [fromTime, setFromTime] = useState("08:00");
  const [toTime, setToTime] = useState("10:00");
  const [kinds, setKinds] = useState<ComplianceEventKind[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const outage = mode === "outage";
  const valid = reason && (!outage || (day.startsWith(month) && toTime > fromTime));

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await onSubmit({
        reason,
        note: note.trim(),
        outage: outage
          ? {
              from: zonedTimeToUtc(day, `${fromTime}:00`).toISOString(),
              to: zonedTimeToUtc(day, `${toTime}:00`).toISOString(),
              kinds,
            }
          : undefined,
      });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Nothing was waived");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <ActionDialogContent busy={busy}>
        <DialogHeader>
          <DialogTitle>{outage ? "Waive a confirmed outage" : `Waive ${plural(count, "missed check-in")}`}</DialogTitle>
          <DialogDescription>
            {outage
              ? "Every check-in missed by anyone and due inside the window is waived in one action. Who and when are recorded; a waiver cannot be undone."
              : "A waived miss leaves both the required and the performed count. Who and when are recorded; a waiver cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {outage ? (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="outage-day">Day</Label>
                  <Input id="outage-day" type="date" value={day} min={`${month}-01`} max={`${month}-31`} onChange={(e) => setDay(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="outage-from">From</Label>
                  <Input id="outage-from" type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="outage-to">To</Label>
                  <Input id="outage-to" type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Check-ins affected</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {KINDS.map((kind) => (
                    <label key={kind} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={kinds.includes(kind)}
                        onCheckedChange={(checked) => setKinds((prev) => (checked ? [...prev, kind] : prev.filter((k) => k !== kind)))}
                      />
                      {EVENT_KIND_LABELS[kind]}
                    </label>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">None ticked: every kind. Times are Dubai time.</p>
              </div>
            </>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="waiver-reason">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="waiver-reason">
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {WAIVER_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="waiver-note">Note</Label>
            <Textarea id="waiver-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {problem ? <p className="text-destructive text-sm">{problem}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton pending={busy} disabled={!valid} onClick={() => void submit()}>
            Waive
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
