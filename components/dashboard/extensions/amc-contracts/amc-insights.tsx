"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Gauge,
  Inbox,
  ListChecks,
  MapPin,
  Percent,
  PhoneCall,
  ReceiptText,
  Repeat,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";

import { DatePickerField } from "@/components/dashboard/extensions/amc/components/date-picker-field";
import { AMC_STATUS_LABELS, type AmcSubmissionStatus } from "@/components/dashboard/extensions/amc/amc-types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionCard, StatCard, StatCardGrid, SubHeading } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton, SectionSkeleton, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { CONTRACT_STATUS_NAMES, type ContractStatus } from "@/lib/amc/contract-lifecycle";
import { formatQuantity, todayInDubai } from "@/lib/amc/contracts";
import { OUTCOME_GROUPS } from "@/lib/amc/job-sheets";
import { CHEQUE_STATUS_LABELS, type ChequeStatus } from "@/lib/amc/payments";
import { AGEING_BUCKETS, REASON_GROUPS } from "@/lib/amc/reports";
import type { ExportColumn, ExportRow } from "@/lib/snagging/export-table";
import { cn } from "@/lib/utils";
import { formatCurrencyAED } from "@/utils/format-currency";
import {
  insightsService,
  type CommercialReport,
  type ManagementDashboard,
  type OperationalReport,
} from "@/modules/amc-contracts/insights-service";

import { ExportMenu } from "./export-menu";
import { useAmcData } from "./use-amc-data";

/**
 * The management dashboard and the operational and commercial reports
 * (Phase 12: DEV-411, 412, 414) on the AMC Reports page. The server counts
 * everything from the contracts the viewer may see; each table's export is
 * exactly its rows.
 */

const BASE = "/extensions/amc-contracts";

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${value.toLocaleString("en-AE", { maximumFractionDigits: 1 })}%`;
const humanize = (key: string) => (key ? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ") : "—");
const monthLabel = (key: string) => {
  if (!/^\d{4}-\d{2}$/.test(key)) return key;
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));
};
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const proposalStatus = (key: string) => AMC_STATUS_LABELS[key as AmcSubmissionStatus] ?? humanize(key);
const contractStatus = (key: string) => CONTRACT_STATUS_NAMES[key as ContractStatus] ?? humanize(key);
const priorityLabel = (p: string) => (p === "emergency" ? "Emergency" : "Non emergency");
const unitLabel = (t: string) => (t === "hours" ? "Hours" : t === "visits" ? "Visits" : humanize(t));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------------------ */
/* The period (Operations and Commercial)                              */
/* ------------------------------------------------------------------ */

export interface ReportPeriod {
  from: string;
  to: string;
}

type PresetKey = "month" | "last_month" | "quarter" | "year";
const PRESETS: ReadonlyArray<{ key: PresetKey; label: string }> = [
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
];

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function presetPeriod(key: PresetKey, today: string): ReportPeriod {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (key === "last_month") {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    /* Day 0 of this month is the last day of the one before. */
    const last = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
    return { from: iso(py, pm, 1), to: iso(py, pm, last) };
  }
  if (key === "quarter") return { from: iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1), to: today };
  if (key === "year") return { from: iso(y, 1, 1), to: today };
  return { from: iso(y, m, 1), to: today };
}

/** This month so far, in Dubai: the server's own default. */
export function defaultReportPeriod(): ReportPeriod {
  return presetPeriod("month", todayInDubai());
}

export function PeriodPicker({ value, onChange }: { value: ReportPeriod; onChange: (next: ReportPeriod) => void }) {
  const today = todayInDubai();
  const active = PRESETS.find((p) => {
    const period = presetPeriod(p.key, today);
    return period.from === value.from && period.to === value.to;
  })?.key;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Period presets">
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={active === p.key ? "default" : "outline"}
            aria-pressed={active === p.key}
            onClick={() => onChange(presetPeriod(p.key, today))}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid w-40 gap-1">
          <Label htmlFor="amc-report-from" className="text-muted-foreground text-xs">
            From
          </Label>
          <DatePickerField
            id="amc-report-from"
            value={value.from}
            onChange={(from) => from && onChange({ from, to: from > value.to ? from : value.to })}
          />
        </div>
        <div className="grid w-40 gap-1">
          <Label htmlFor="amc-report-to" className="text-muted-foreground text-xs">
            To
          </Label>
          <DatePickerField id="amc-report-to" value={value.to} minDate={value.from} onChange={(to) => to && onChange({ from: value.from, to })} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

type CellValue = string | number | null;

interface Col<R> {
  key: string;
  label: string;
  /** The figure, as exported (blank when null). */
  value: (row: R) => CellValue;
  kind?: "text" | "number" | "money" | "percent";
  /** What the screen shows, when it is more than the value. */
  cell?: (row: R) => ReactNode;
  /** The export's header, when it needs a unit the screen does not. */
  exportLabel?: string;
}

const isFigure = (kind: Col<unknown>["kind"]) => kind === "number" || kind === "money" || kind === "percent";

function renderCell<R>(col: Col<R>, row: R): ReactNode {
  if (col.cell) return col.cell(row);
  const v = col.value(row);
  if (col.kind === "money") return <Money value={typeof v === "number" ? v : 0} className="text-sm" />;
  if (col.kind === "percent") return pct(typeof v === "number" ? v : null);
  if (v === null || v === "") return <span className="text-muted-foreground">—</span>;
  return typeof v === "number" ? formatQuantity(v) : v;
}

const exportColumns = <R,>(cols: Col<R>[]): ExportColumn[] =>
  cols.map((c) => ({ key: c.key, label: c.exportLabel ?? (c.kind === "money" ? `${c.label} (AED)` : c.kind === "percent" ? `${c.label} (%)` : c.label) }));
const exportRows = <R,>(cols: Col<R>[], rows: R[]): ExportRow[] =>
  rows.map((r) => Object.fromEntries(cols.map((c) => [c.key, c.value(r) ?? ""])) as ExportRow);

/** A compact table: figures right-aligned, a muted line when there is nothing. */
function CompactTable<R>({
  columns,
  rows,
  rowKey,
  empty,
  rowClassName,
  minWidth,
}: {
  columns: Col<R>[];
  rows: R[];
  rowKey: (row: R, index: number) => string;
  empty: string;
  rowClassName?: (row: R) => string | undefined;
  minWidth?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <Table className={minWidth}>
        <TableHeader>
          <TableRow>
            {columns.map((c, i) => (
              <TableHead key={c.key} className={cn(isFigure(c.kind) && "text-right", i === 0 && "pl-5", i === columns.length - 1 && "pr-5")}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="text-muted-foreground px-5 py-6 text-center text-sm">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r, index) => (
              <TableRow key={rowKey(r, index)} className={rowClassName?.(r)}>
                {columns.map((c, i) => (
                  <TableCell
                    key={c.key}
                    className={cn(
                      "text-sm",
                      isFigure(c.kind) && "text-right tabular-nums",
                      i === 0 && "pl-5 font-medium",
                      i === columns.length - 1 && "pr-5",
                    )}
                  >
                    {renderCell(c, r)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** A report section: the card, its table and the table's export. */
function ReportTable<R>({
  title,
  description,
  icon,
  name,
  columns,
  rows,
  rowKey,
  empty,
  rowClassName,
  minWidth,
  children,
  className,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  /** The export file's name. */
  name: string;
  columns: Col<R>[];
  rows: R[];
  rowKey: (row: R, index: number) => string;
  empty: string;
  rowClassName?: (row: R) => string | undefined;
  minWidth?: string;
  /** Figures above the table. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <SectionCard
      title={title}
      description={description}
      icon={icon}
      className={className}
      bodyClassName="pb-2"
      action={<ExportMenu name={name} columns={exportColumns(columns)} rows={exportRows(columns, rows)} />}
    >
      {children}
      <CompactTable columns={columns} rows={rows} rowKey={rowKey} empty={empty} rowClassName={rowClassName} minWidth={minWidth} />
    </SectionCard>
  );
}

interface Figure {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "bad" | "warn";
}

/** Small figures inside a section card: lighter than a row of stat cards. */
function Figures({ items, className }: { items: Figure[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 px-5 pb-4 sm:grid-cols-3 xl:grid-cols-4", className)}>
      {items.map((f) => (
        <div key={f.label} className="bg-muted/30 rounded-lg border px-3 py-2.5">
          <p className="text-muted-foreground text-xs">{f.label}</p>
          <p className={cn("mt-0.5 text-xl tabular-nums", f.tone === "bad" && "text-danger", f.tone === "warn" && "text-warning")}>{f.value}</p>
          {f.hint ? <p className="text-muted-foreground mt-0.5 text-xs">{f.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}

/** A section made of figures only, with the figures as a one-row export. */
function FigureSection({
  title,
  description,
  icon,
  name,
  items,
  exportRow,
  className,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  name: string;
  items: Figure[];
  exportRow: Array<{ label: string; value: CellValue }>;
  className?: string;
}) {
  const columns = exportRow.map((e, i) => ({ key: `c${i}`, label: e.label }));
  const row = Object.fromEntries(exportRow.map((e, i) => [`c${i}`, e.value ?? ""])) as ExportRow;
  return (
    <SectionCard title={title} description={description} icon={icon} className={className} bodyClassName="pb-1" action={<ExportMenu name={name} columns={columns} rows={[row]} />}>
      <Figures items={items} />
    </SectionCard>
  );
}

function PercentBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-center justify-end gap-2">
      <Progress
        value={Math.min(100, value)}
        className="h-1.5 w-20"
        indicatorClassName={value > 100 ? "bg-danger" : "bg-brand"}
        aria-label={`${pct(value)} booked`}
      />
      <span className={cn("w-14 text-right tabular-nums", value > 100 && "text-danger")}>{pct(value)}</span>
    </div>
  );
}

function ReportSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: sections }).map((_, i) => (
        <SectionSkeleton key={i}>
          <ListSkeleton rows={4} />
        </SectionSkeleton>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard (DEV-414)                                                 */
/* ------------------------------------------------------------------ */

export function DashboardReport() {
  const { data, error, loading, reload } = useAmcData(() => insightsService.dashboard(), "amc-dashboard");
  if (error) return <ErrorState title="Could not load the dashboard" message={error} onRetry={reload} />;
  if (loading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <StatGridSkeleton count={3} />
        <StatGridSkeleton count={4} />
        <StatGridSkeleton count={5} />
        <SectionSkeleton>
          <ListSkeleton rows={4} />
        </SectionSkeleton>
      </div>
    );
  }
  return <DashboardBody d={data.dashboard} />;
}

function DashboardGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <SubHeading>{title}</SubHeading>
      {children}
    </section>
  );
}

function DashboardBody({ d }: { d: ManagementDashboard }) {
  const proposals = (key: string) => d.pipeline.proposalsByStatus.find((p) => p.key === key)?.count ?? 0;
  const inApproval = proposals("awaiting_approval");
  const sentBack = proposals("sent_back");
  const withClient = proposals("proposal_sent") + proposals("contract_sent");
  const { delivery, workforce, commercial } = d;
  return (
    <div className="flex flex-col gap-6">
      <DashboardGroup title="Pipeline">
        <StatCardGrid columns={3}>
          <StatCard label="Open enquiries" value={d.pipeline.openEnquiries} headline="Not won or lost yet" caption="All stages" href={`${BASE}/enquiries`} />
          <StatCard
            label="Proposals in approval"
            value={inApproval}
            headline={sentBack ? `${sentBack} sent back to the owner` : "None sent back"}
            caption="Waiting for an approver"
            tone={inApproval ? "review" : "neutral"}
          />
          <StatCard label="Proposals with the client" value={withClient} headline={`${proposals("proposal_approved")} accepted, not signed`} caption="Proposal or contract sent" />
        </StatCardGrid>
      </DashboardGroup>

      <div className="grid gap-6 lg:grid-cols-2">
        <DashboardGroup title="Contracts">
          <StatCardGrid columns={4} className="@xl/main:grid-cols-2 @5xl/main:grid-cols-2">
            <StatCard label="Active contracts" value={d.contracts.active} headline="In force today" caption="Contracts you can see" href={`${BASE}?status=active`} />
            <StatCard label="Active contract value" value={<Money value={d.contracts.activeValue} className="text-xl" />} headline="Incl. VAT, as signed" caption="Contracts in force" />
          </StatCardGrid>
        </DashboardGroup>
        <DashboardGroup title="Approvals">
          <StatCardGrid columns={4} className="@xl/main:grid-cols-2 @5xl/main:grid-cols-2">
            <StatCard
              label="Proposal approvals pending"
              value={d.approvals.pendingProposalSteps}
              headline="Steps waiting for you or your team"
              caption="Approval ladder"
              tone={d.approvals.pendingProposalSteps ? "review" : "neutral"}
            />
            <StatCard
              label="Job sheets awaiting review"
              value={d.approvals.jobSheetsAwaitingReview}
              headline="Submitted by technicians"
              caption="Open the review queue"
              tone={d.approvals.jobSheetsAwaitingReview ? "review" : "neutral"}
              href={`${BASE}/job-reviews`}
            />
          </StatCardGrid>
        </DashboardGroup>
      </div>

      <DashboardGroup title="Delivery">
        <StatCardGrid columns={5}>
          <StatCard label="Visits due this week" value={delivery.visitsDueThisWeek} headline="Window open in the next 7 days" caption="Not done yet" href={`${BASE}/board`} />
          <StatCard label="Overdue visits" value={delivery.overdueVisits} headline="Window already passed" caption="Still open" tone={delivery.overdueVisits ? "bad" : "neutral"} />
          <StatCard label="Pending access" value={delivery.pendingAccess} headline="Waiting on the client or building" caption="Visits" tone={delivery.pendingAccess ? "progress" : "neutral"} />
          <StatCard
            label="Open call outs"
            value={delivery.openCallOuts}
            headline={`${delivery.openEmergencies} ${delivery.openEmergencies === 1 ? "emergency" : "emergencies"}`}
            caption="Not closed or cancelled"
            tone={delivery.openEmergencies ? "progress" : "neutral"}
            href={`${BASE}/call-outs`}
          />
          <StatCard
            label="SLA missed"
            value={delivery.slaMissed}
            headline="Open, past the response target"
            caption="Call outs not attended"
            tone={delivery.slaMissed ? "bad" : "good"}
            href={`${BASE}/call-outs`}
          />
        </StatCardGrid>
      </DashboardGroup>

      <DashboardGroup title="Workforce">
        <StatCardGrid columns={3}>
          <StatCard label="Active technicians" value={workforce.activeTechnicians} headline="In the technician list" caption="Active in FSM" href={`${BASE}/technicians`} />
          <StatCard label="Booked hours" value={formatQuantity(workforce.bookedHoursNext7Days)} headline="AMC visits and call outs" caption="Next 7 days" />
          <StatCard
            label="Utilisation"
            value={pct(workforce.utilisationNext7Days)}
            headline="Booked against 8 h per working day"
            caption="Next 7 days"
            tone={workforce.utilisationNext7Days !== null && workforce.utilisationNext7Days > 100 ? "bad" : "neutral"}
          />
        </StatCardGrid>
      </DashboardGroup>

      <DashboardGroup title="Commercial">
        <StatCardGrid columns={4}>
          <StatCard label="Signed this month" value={<Money value={commercial.signedThisMonth} className="text-xl" />} headline="Contract value, incl. VAT" caption="Since the 1st" />
          <StatCard
            label="Collected this month"
            value={<Money value={commercial.collectedThisMonth} className="text-xl" />}
            headline="Payments received"
            caption="Voided payments excluded"
            href={`${BASE}/payments`}
          />
          <StatCard
            label="Overdue"
            value={<Money value={commercial.overdue} className="text-xl" />}
            headline="Instalments past their due date"
            caption="Still owed"
            tone={commercial.overdue > 0 ? "bad" : "neutral"}
          />
          <StatCard
            label="Quotations awaiting the client"
            value={commercial.quotationsAwaitingClient}
            headline={formatCurrencyAED(commercial.quotationsAwaitingValue)}
            caption="Additional work shared"
            href={`${BASE}/additional-works`}
          />
        </StatCardGrid>
      </DashboardGroup>

      <DashboardGroup title="Renewals">
        <StatCardGrid columns={3}>
          {d.renewals.map((r) => (
            <StatCard
              key={r.days}
              label={`Ending within ${r.days} days`}
              value={r.count}
              headline={formatCurrencyAED(r.value)}
              caption={`${r.started} with a renewal started`}
              tone={r.days === 30 && r.count > r.started ? "progress" : "neutral"}
            />
          ))}
        </StatCardGrid>
      </DashboardGroup>

      <div className="grid gap-6 lg:grid-cols-3">
        <Breakdown title="Enquiries by stage" icon={<Inbox />} rows={d.pipeline.enquiriesByStage} label={(k) => k} empty="No open enquiries." />
        <Breakdown title="Proposals by status" icon={<ClipboardList />} rows={d.pipeline.proposalsByStatus} label={proposalStatus} empty="No proposals in progress." />
        <Breakdown title="Contracts by status" icon={<ListChecks />} rows={d.contracts.byStatus} label={contractStatus} empty="No contracts yet." />
      </div>
    </div>
  );
}

function Breakdown({
  title,
  icon,
  rows,
  label,
  empty,
}: {
  title: string;
  icon: ReactNode;
  rows: Array<{ key: string; count: number }>;
  label: (key: string) => string;
  empty: string;
}) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <SectionCard title={title} icon={icon} bodyClassName="px-5 pb-4">
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate">{label(r.key)}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="bg-muted hidden h-1.5 w-16 overflow-hidden rounded-full sm:block" aria-hidden>
                  <span className="bg-brand block h-full rounded-full" style={{ width: `${total ? Math.round((r.count / total) * 100) : 0}%` }} />
                </span>
                <span className="w-8 text-right font-medium tabular-nums">{r.count}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Operations (DEV-411)                                                */
/* ------------------------------------------------------------------ */

export function OperationsReport({ period }: { period: ReportPeriod }) {
  const { data, error, loading, reload } = useAmcData(() => insightsService.operational(period.from, period.to), `ops:${period.from}:${period.to}`);
  if (error) return <ErrorState title="Could not load the operations report" message={error} onRetry={reload} />;
  if (loading || !data) return <ReportSkeleton sections={4} />;
  return <OperationsBody r={data.report} />;
}

type CallOutRow = OperationalReport["callOuts"][number];
type AtRiskRow = OperationalReport["atRisk"][number];
type UtilisationRow = OperationalReport["utilisation"][number];
type AllowanceRow = OperationalReport["allowances"][number];
type AccessRow = OperationalReport["accessFailures"][number];

const CALL_OUT_COLUMNS: Col<CallOutRow>[] = [
  { key: "priority", label: "Priority", value: (r) => priorityLabel(r.priority) },
  { key: "total", label: "Total", kind: "number", value: (r) => r.total },
  { key: "met", label: "SLA met", kind: "number", value: (r) => r.met },
  { key: "missed", label: "SLA missed", kind: "number", value: (r) => r.missed, cell: (r) => <span className={cn(r.missed > 0 && "text-danger")}>{r.missed}</span> },
  { key: "metPercent", label: "Met", kind: "percent", value: (r) => r.metPercent },
  { key: "open", label: "Open", kind: "number", value: (r) => r.open },
  { key: "covered", label: "Covered", kind: "number", value: (r) => r.covered },
  { key: "chargeable", label: "Chargeable", kind: "number", value: (r) => r.chargeable },
  { key: "misuse", label: "Misuse", kind: "number", value: (r) => r.misuse },
];

const AT_RISK_COLUMNS: Col<AtRiskRow>[] = [
  {
    key: "contract",
    label: "Contract",
    value: (r) => r.number,
    cell: (r) => (
      <Link href={`${BASE}/${r.contractId}`} className="hover:text-brand underline-offset-2 hover:underline">
        {r.number || "Contract"}
      </Link>
    ),
  },
  { key: "customer", label: "Client", value: (r) => r.customerName },
  { key: "property", label: "Property", value: (r) => r.propertyLabel },
  { key: "end", label: "Ends", value: (r) => r.endDate, cell: (r) => <span className="tabular-nums">{dayLabel(r.endDate)}</span> },
  { key: "daysLeft", label: "Days left", kind: "number", value: (r) => r.daysLeft },
  { key: "remaining", label: "Visits left", kind: "number", value: (r) => r.remaining },
  { key: "overdue", label: "Overdue", kind: "number", value: (r) => r.overdue, cell: (r) => <span className={cn(r.overdue > 0 && "text-danger")}>{r.overdue}</span> },
  { key: "reasons", label: "Why", value: (r) => r.reasons.join("; "), cell: (r) => <span className="text-muted-foreground">{r.reasons.join(" · ")}</span> },
];

const UTILISATION_COLUMNS: Col<UtilisationRow>[] = [
  { key: "name", label: "Technician", value: (r) => r.name },
  { key: "jobs", label: "Jobs", kind: "number", value: (r) => r.jobs },
  { key: "booked", label: "Booked hours", kind: "number", value: (r) => r.bookedHours },
  { key: "available", label: "Available hours", kind: "number", value: (r) => r.availableHours },
  { key: "percent", label: "Utilisation", kind: "percent", value: (r) => r.percent, cell: (r) => <PercentBar value={r.percent} /> },
];

const ALLOWANCE_COLUMNS: Col<AllowanceRow>[] = [
  {
    key: "contract",
    label: "Contract",
    value: (r) => r.number,
    cell: (r) => (
      <Link href={`${BASE}/${r.contractId}`} className="hover:text-brand underline-offset-2 hover:underline">
        {r.number || "Contract"}
      </Link>
    ),
  },
  { key: "customer", label: "Client", value: (r) => r.customerName },
  { key: "service", label: "Service", value: (r) => r.serviceLabel },
  { key: "unit", label: "Unit", value: (r) => unitLabel(r.entitlementType) },
  { key: "included", label: "Included", kind: "number", value: (r) => r.included },
  { key: "used", label: "Used", kind: "number", value: (r) => r.used },
  { key: "reserved", label: "Booked", kind: "number", value: (r) => r.reserved },
  { key: "remaining", label: "Remaining", kind: "number", value: (r) => r.remaining },
  { key: "percent", label: "Used", kind: "percent", exportLabel: "Used (%)", value: (r) => r.percent },
  { key: "chargeable", label: "Chargeable call outs", kind: "number", value: (r) => r.chargeableCallOuts },
];

const ACCESS_COLUMNS: Col<AccessRow>[] = [
  { key: "community", label: "Community", value: (r) => r.community },
  { key: "access", label: "Access failure", kind: "number", value: (r) => r.access },
  { key: "noAccess", label: "No access given", kind: "number", value: (r) => r.noAccessGiven },
  { key: "total", label: "Total", kind: "number", value: (r) => r.total },
];

/* At 80% an allowance is nearly gone; at 100% it is used up. */
const allowanceTone = (r: AllowanceRow) => (r.percent === null ? undefined : r.percent >= 100 ? "bg-danger/5" : r.percent >= 80 ? "bg-warning/5" : undefined);

function OperationsBody({ r }: { r: OperationalReport }) {
  const { adherence: a, backlog: b } = r;
  const reasonRows = REASON_GROUPS.map((g) => ({ group: OUTCOME_GROUPS[g].label, count: b.byReasonGroup[g] ?? 0 }));
  const backlogRows: Array<{ measure: string; count: number }> = [
    { measure: "Due now", count: b.due },
    { measure: "Overdue", count: b.overdue },
    { measure: "Upcoming", count: b.upcoming },
    { measure: "Pending access", count: b.pendingAccess },
    { measure: "Not completed", count: b.notCompleted },
    ...reasonRows.map((x) => ({ measure: `Not done: ${x.group}`, count: x.count })),
  ];
  const nearFull = r.allowances.filter((x) => x.percent !== null && x.percent >= 80).length;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <FigureSection
          title="Schedule adherence"
          description={`Visits done between ${dayLabel(r.period.from)} and ${dayLabel(r.period.to)}, against their service window.`}
          icon={<CalendarCheck />}
          name="schedule-adherence"
          items={[
            { label: "Visits done", value: a.done },
            { label: "Within the window", value: pct(a.percent), hint: `${a.within} of ${a.done}` },
            { label: "Early", value: a.early, hint: "Before the window opened" },
            { label: "Late", value: a.late, hint: "After the window closed", tone: a.late ? "bad" : undefined },
          ]}
          exportRow={[
            { label: "From", value: r.period.from },
            { label: "To", value: r.period.to },
            { label: "Visits done", value: a.done },
            { label: "Within the window", value: a.within },
            { label: "Within the window (%)", value: a.percent },
            { label: "Early", value: a.early },
            { label: "Late", value: a.late },
          ]}
        />
        <SectionCard
          title="Visits backlog"
          description="Open visits today, whatever the period, and why visits were not completed."
          icon={<CalendarClock />}
          bodyClassName="pb-2"
          action={<ExportMenu name="visits-backlog" columns={[{ key: "measure", label: "Measure" }, { key: "count", label: "Visits" }]} rows={backlogRows} />}
        >
          <Figures
            className="sm:grid-cols-5 xl:grid-cols-5"
            items={[
              { label: "Due now", value: b.due },
              { label: "Overdue", value: b.overdue, tone: b.overdue ? "bad" : undefined },
              { label: "Upcoming", value: b.upcoming },
              { label: "Pending access", value: b.pendingAccess, tone: b.pendingAccess ? "warn" : undefined },
              { label: "Not completed", value: b.notCompleted },
            ]}
          />
          <CompactTable
            columns={[
              { key: "group", label: "Not completed or partial, by reason", value: (x: { group: string; count: number }) => x.group },
              { key: "count", label: "Trades", kind: "number", value: (x: { group: string; count: number }) => x.count },
            ]}
            rows={reasonRows}
            rowKey={(x) => x.group}
            empty="No reasons recorded."
          />
        </SectionCard>
      </div>

      <ReportTable
        title="Call outs by priority"
        description="Reported in the period. Met and missed are against the response target; missed includes open ones already past it."
        icon={<PhoneCall />}
        name="call-outs-by-priority"
        columns={CALL_OUT_COLUMNS}
        rows={r.callOuts}
        rowKey={(x) => x.priority}
        empty="No call outs in this period."
        minWidth="min-w-[720px]"
      />

      <ReportTable
        title="Contracts at risk"
        description="Active contracts with a visit overdue, or more visits left than the time remaining allows."
        icon={<AlertTriangle />}
        name="contracts-at-risk"
        columns={AT_RISK_COLUMNS}
        rows={r.atRisk}
        rowKey={(x) => x.contractId}
        empty="No contract is at risk of ending incomplete."
        minWidth="min-w-[900px]"
      />

      <ReportTable
        title="Technician utilisation"
        description={`AMC visits and call outs booked in the period, against ${plural(r.workingDays, "working day")} of 8 hours.`}
        icon={<Gauge />}
        name="technician-utilisation"
        columns={UTILISATION_COLUMNS}
        rows={r.utilisation}
        rowKey={(x) => x.fsmId}
        empty="No technician has AMC work booked in this period."
        minWidth="min-w-[620px]"
      />

      <ReportTable
        title="Allowance use"
        description={
          nearFull
            ? `Visit and hour allowances, the busiest first. ${plural(nearFull, "allowance")} at 80% or more are highlighted.`
            : "Visit and hour allowances, the busiest first. None is at 80% yet."
        }
        icon={<BarChart3 />}
        name="allowance-use"
        columns={ALLOWANCE_COLUMNS}
        rows={r.allowances}
        rowKey={(x, i) => `${x.contractId}-${x.serviceLabel}-${i}`}
        rowClassName={allowanceTone}
        empty="No visit or hour allowances on the contracts you can see."
        minWidth="min-w-[980px]"
      />

      <ReportTable
        title="Access failures by community"
        description="Trades not done for want of access: community or building refusals, and clients who gave no access."
        icon={<MapPin />}
        name="access-failures"
        columns={ACCESS_COLUMNS}
        rows={r.accessFailures}
        rowKey={(x) => x.community}
        empty="No access failures recorded."
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Commercial (DEV-412)                                                */
/* ------------------------------------------------------------------ */

export function CommercialReportView({ period }: { period: ReportPeriod }) {
  const { data, error, loading, reload } = useAmcData(() => insightsService.commercial(period.from, period.to), `com:${period.from}:${period.to}`);
  if (error) return <ErrorState title="Could not load the commercial report" message={error} onRetry={reload} />;
  if (loading || !data) return <ReportSkeleton sections={4} />;
  return <CommercialBody r={data.report} />;
}

type FunnelRow = CommercialReport["enquiries"]["bySource"][number];
type DiscountRow = CommercialReport["discounts"][number];
type SignedRow = CommercialReport["signedValue"][number];
type AgeingRow = CommercialReport["ageing"][number];
type CollectionRow = CommercialReport["collections"][number];
type ChequeRow = CommercialReport["cheques"][number];

const funnelColumns = (label: string, key: (k: string) => string = (k) => k): Col<FunnelRow>[] => [
  { key: "key", label, value: (r) => key(r.key) },
  { key: "total", label: "Enquiries", kind: "number", value: (r) => r.total },
  { key: "won", label: "Won", kind: "number", value: (r) => r.won },
  { key: "lost", label: "Lost", kind: "number", value: (r) => r.lost },
  { key: "open", label: "Open", kind: "number", value: (r) => r.open },
  { key: "conversion", label: "Conversion", kind: "percent", value: (r) => r.conversion },
];

const DISCOUNT_COLUMNS: Col<DiscountRow>[] = [
  { key: "name", label: "Approval level", value: (r) => r.name },
  { key: "count", label: "Proposals", kind: "number", value: (r) => r.count },
  { key: "value", label: "Value", kind: "money", value: (r) => r.value },
  { key: "average", label: "Average discount", kind: "percent", value: (r) => r.averageDiscount },
];

const SIGNED_COLUMNS: Col<SignedRow>[] = [
  { key: "month", label: "Month", value: (r) => r.month, cell: (r) => monthLabel(r.month) },
  { key: "count", label: "Contracts", kind: "number", value: (r) => r.count },
  { key: "residential", label: "Residential", kind: "money", value: (r) => r.residential },
  { key: "commercial", label: "Commercial", kind: "money", value: (r) => r.commercial },
  { key: "unknown", label: "Not recorded", kind: "money", value: (r) => r.unknown },
  { key: "total", label: "Total", kind: "money", value: (r) => r.total, cell: (r) => <Money value={r.total} className="text-sm font-medium" /> },
];

const COLLECTION_COLUMNS: Col<CollectionRow>[] = [
  { key: "month", label: "Month", value: (r) => r.month, cell: (r) => monthLabel(r.month) },
  { key: "amount", label: "Received", kind: "money", value: (r) => r.amount },
];

const AGEING_COLUMNS: Col<AgeingRow>[] = [
  { key: "bucket", label: "Days past due", value: (r) => r.bucket, cell: (r) => (r.bucket === "Not due" ? "Not due yet" : `${r.bucket} days`) },
  { key: "count", label: "Instalments", kind: "number", value: (r) => r.count },
  { key: "amount", label: "Owed", kind: "money", value: (r) => r.amount },
];

const CHEQUE_COLUMNS: Col<ChequeRow>[] = [
  { key: "status", label: "Status", value: (r) => CHEQUE_STATUS_LABELS[r.status as ChequeStatus] ?? humanize(r.status) },
  { key: "count", label: "Cheques", kind: "number", value: (r) => r.count },
  { key: "amount", label: "Amount", kind: "money", value: (r) => r.amount },
];

function CommercialBody({ r }: { r: CommercialReport }) {
  const { enquiries: e, proposals: p, additionalWork: w, renewals: n } = r;
  const ageingRows = [...r.ageing].sort(
    (x, y) => AGEING_BUCKETS.indexOf(x.bucket as (typeof AGEING_BUCKETS)[number]) - AGEING_BUCKETS.indexOf(y.bucket as (typeof AGEING_BUCKETS)[number]),
  );
  const range = `${dayLabel(r.period.from)} to ${dayLabel(r.period.to)}`;
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <SubHeading>{`Enquiries · ${e.total} received, ${range}`}</SubHeading>
        <div className="grid gap-6 xl:grid-cols-2">
          <ReportTable
            title="By source"
            icon={<TrendingUp />}
            name="enquiries-by-source"
            columns={funnelColumns("Source", (k) => k || "Not recorded")}
            rows={e.bySource}
            rowKey={(x) => x.key}
            empty="No enquiries in this period."
          />
          <ReportTable
            title="By owner"
            icon={<Users />}
            name="enquiries-by-owner"
            columns={funnelColumns("Owner")}
            rows={e.byOwner}
            rowKey={(x) => x.key}
            empty="No enquiries in this period."
          />
          <ReportTable
            title="By month"
            icon={<CalendarClock />}
            name="enquiries-by-month"
            columns={funnelColumns("Month", monthLabel)}
            rows={e.byMonth}
            rowKey={(x) => x.key}
            empty="No enquiries in this period."
          />
          <ReportTable
            title="Lost reasons"
            icon={<AlertTriangle />}
            name="enquiries-lost-reasons"
            columns={[
              { key: "reason", label: "Reason", value: (x: { reason: string; count: number }) => x.reason },
              { key: "count", label: "Enquiries", kind: "number", value: (x: { reason: string; count: number }) => x.count },
            ]}
            rows={e.lostReasons}
            rowKey={(x) => x.reason}
            empty="No enquiry was lost in this period."
          />
        </div>
      </section>

      <FigureSection
        title="Proposals and conversion"
        description={`Proposals created ${range}. Rates are of those that reached the client.`}
        icon={<ClipboardList />}
        name="proposal-conversion"
        items={[
          { label: "Created", value: p.created },
          { label: "In approval", value: p.inApproval },
          { label: "Sent to the client", value: p.sent },
          { label: "Accepted", value: p.accepted, hint: `${pct(p.acceptanceRate)} of sent` },
          { label: "Rejected", value: p.rejected, tone: p.rejected ? "warn" : undefined },
          { label: "Signed", value: p.signed, hint: `${pct(p.signedRate)} of sent` },
          { label: "Value created", value: <Money value={p.value} className="text-xl" />, hint: "Before VAT" },
          { label: "Value signed", value: <Money value={p.signedValue} className="text-xl" />, hint: "Before VAT" },
        ]}
        exportRow={[
          { label: "From", value: r.period.from },
          { label: "To", value: r.period.to },
          { label: "Created", value: p.created },
          { label: "In approval", value: p.inApproval },
          { label: "Sent", value: p.sent },
          { label: "Accepted", value: p.accepted },
          { label: "Rejected", value: p.rejected },
          { label: "Signed", value: p.signed },
          { label: "Acceptance rate (%)", value: p.acceptanceRate },
          { label: "Signed rate (%)", value: p.signedRate },
          { label: "Value (AED)", value: p.value },
          { label: "Signed value (AED)", value: p.signedValue },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <ReportTable
          title="Discounts by approval level"
          description="Proposals created in the period, grouped by the level their discount needs."
          icon={<Percent />}
          name="discounts-by-level"
          columns={DISCOUNT_COLUMNS}
          rows={r.discounts}
          rowKey={(x) => String(x.level)}
          empty="No proposals in this period."
        />
        <ReportTable
          title="Cheques by status"
          description="Every cheque on the contracts you can see, whatever the period."
          icon={<ReceiptText />}
          name="cheques-by-status"
          columns={CHEQUE_COLUMNS}
          rows={r.cheques}
          rowKey={(x) => x.status}
          empty="No cheques recorded."
        />
      </div>

      <ReportTable
        title="Signed value by month"
        description="Contracts signed in the period, incl. VAT, by property category."
        icon={<BarChart3 />}
        name="signed-value-by-month"
        columns={SIGNED_COLUMNS}
        rows={r.signedValue}
        rowKey={(x) => x.month}
        empty="No contract signed in this period."
        minWidth="min-w-[720px]"
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <ReportTable
          title="Collections"
          description="Payments received in the period, by month. Voided payments are excluded."
          icon={<Wallet />}
          name="collections-by-month"
          columns={COLLECTION_COLUMNS}
          rows={r.collections}
          rowKey={(x) => x.month}
          empty="Nothing received in this period."
        />
        <ReportTable
          title="Ageing"
          description="What is still owed today on instalments, by days past the due date."
          icon={<Banknote />}
          name="instalment-ageing"
          columns={AGEING_COLUMNS}
          rows={ageingRows}
          rowKey={(x) => x.bucket}
          rowClassName={(x) => (x.bucket === "90+" && x.amount > 0 ? "bg-danger/5" : undefined)}
          empty="Nothing owed."
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <FigureSection
          title="Additional-work revenue"
          description="Additional work raised in the period, by how far it got. Amounts incl. VAT."
          icon={<Wrench />}
          name="additional-work-revenue"
          items={[
            { label: "Raised", value: w.raised },
            { label: "Quoted", value: <Money value={w.quoted} className="text-xl" /> },
            { label: "Approved", value: <Money value={w.approved} className="text-xl" />, hint: `${pct(w.approvalRate)} approval rate` },
            { label: "Rejected", value: <Money value={w.rejected} className="text-xl" /> },
            { label: "Invoiced", value: <Money value={w.invoiced} className="text-xl" /> },
            { label: "Paid", value: <Money value={w.paid} className="text-xl" /> },
          ]}
          exportRow={[
            { label: "From", value: r.period.from },
            { label: "To", value: r.period.to },
            { label: "Raised", value: w.raised },
            { label: "Quoted (AED)", value: w.quoted },
            { label: "Approved (AED)", value: w.approved },
            { label: "Rejected (AED)", value: w.rejected },
            { label: "Invoiced (AED)", value: w.invoiced },
            { label: "Paid (AED)", value: w.paid },
            { label: "Approval rate (%)", value: w.approvalRate },
          ]}
        />
        <FigureSection
          title="Renewals"
          description="Contracts ending in the period, and whether they were renewed."
          icon={<Repeat />}
          name="renewal-outcomes"
          items={[
            { label: "Ending", value: n.ending },
            { label: "Renewed", value: n.renewed, hint: `${pct(n.renewalRate)} renewal rate` },
            { label: "In progress", value: n.inProgress },
            { label: "Not started", value: n.notStarted, tone: n.notStarted ? "warn" : undefined },
          ]}
          exportRow={[
            { label: "From", value: r.period.from },
            { label: "To", value: r.period.to },
            { label: "Ending", value: n.ending },
            { label: "Renewed", value: n.renewed },
            { label: "In progress", value: n.inProgress },
            { label: "Not started", value: n.notStarted },
            { label: "Renewal rate (%)", value: n.renewalRate },
          ]}
        />
      </div>
    </div>
  );
}
