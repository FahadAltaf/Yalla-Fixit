"use client";

import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ListChecks,
  ArrowRight,
  BarChart3,
  CalendarCheck,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Download,
  ClipboardList,
  Gauge,
  MapPin,
  Percent,
  PhoneCall,
  ReceiptText,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";

import { Money } from "@/components/ui/money";
import { SectionCard, StatCard, StatCardGrid, SubHeading } from "@/components/dashboard/shared/kaizen";
import { ErrorState, ListSkeleton, SectionSkeleton, StatGridSkeleton } from "@/components/dashboard/shared/kaizen-states";
import { formatQuantity, todayInDubai } from "@/lib/amc/contracts";
import { OUTCOME_GROUPS } from "@/lib/amc/job-sheets";
import { CHEQUE_STATUS_LABELS, type ChequeStatus } from "@/lib/amc/payments";
import { AGEING_BUCKETS, REASON_GROUPS } from "@/lib/amc/reports";
import type { ExportColumn } from "@/lib/snagging/export-table";
import { exportReport, type ReportBlock } from "@/lib/amc/report-export";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatCurrencyAED } from "@/utils/format-currency";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import Link from "next/link";
import { TruncatedText } from "@/components/ui/truncated-text";
import {
  insightsService,
  type CommercialReport,
  type ManagementDashboard,
  type OperationalReport,
} from "@/modules/amc-contracts/insights-service";

import { FunnelBars, PeriodBar, ReportBars, SERIES, ShareRing } from "./amc-report-charts";
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
const priorityLabel = (p: string) => (p === "emergency" ? "Emergency" : "Non emergency");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------------------ */
/* The period (Operations and Commercial)                              */
/* ------------------------------------------------------------------ */

export interface ReportPeriod {
  from: string;
  to: string;
}

type PresetKey = "month" | "last_month" | "quarter" | "year" | "last_12";
const PRESETS: ReadonlyArray<{ key: PresetKey; label: string }> = [
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "last_12", label: "Last 12 months" },
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
  if (key === "last_12") return { from: iso(m === 12 ? y : y - 1, (m % 12) + 1, 1), to: today };
  return { from: iso(y, m, 1), to: today };
}

/** This month so far, in Dubai: the server's own default. */
export function defaultReportPeriod(): ReportPeriod {
  return presetPeriod("month", todayInDubai());
}

/**
 * The report period (23 Nov 2026): a preset list and the same two-month
 * date range picker as Finance's reports, in one bar that says what is shown.
 */
export function PeriodPicker({ value, onChange, actions }: { value: ReportPeriod; onChange: (next: ReportPeriod) => void; actions?: ReactNode }) {
  const today = todayInDubai();
  return (
    <PeriodBar
      from={value.from}
      to={value.to}
      presets={PRESETS.map((p) => ({ key: p.key, label: p.label, ...presetPeriod(p.key, today) }))}
      onChange={(from, to) => onChange({ from, to: to || from })}
      summary={`${dayLabel(value.from)} to ${dayLabel(value.to)}`}
      actions={actions}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

type CellValue = string | number | null;


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


/** Rows of name, count and share, each over a thin bar of its share (the reference dashboard's target rows). */
function ShareRows({ rows, total }: { rows: Array<{ name: string; count: number }>; total: number }) {
  return (
    <ul className="grid gap-4">
      {rows.map((r) => {
        const share = total ? Math.round((r.count / total) * 100) : 0;
        return (
          <li key={r.name} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium">{r.name}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{r.count.toLocaleString("en-AE")}</span>
                <span className="text-muted-foreground ml-1.5 text-xs">{share}%</span>
              </span>
            </div>
            <div className="bg-muted h-1.5 overflow-hidden rounded-full" role="img" aria-label={`${r.name}: ${r.count} of ${total}`}>
              <div className="h-full rounded-full" style={{ width: `${Math.max(r.count ? 2 : 0, share)}%`, background: SERIES.brand }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}


/* ------------------------------------------------------------------ */
/* One view (25 Nov 2026, the user): no tabs                           */
/* ------------------------------------------------------------------ */

/*
  The AMC reports on one page, as BRD 5.15 and Jira ask and no more:

    At a glance   DEV-414 management dashboard: pipeline, contracts,
                  approvals, delivery, workforce, commercial, renewals in
                  30, 60 and 90 days. Today's figures.
    Operations    DEV-411: schedule adherence; visits due, overdue and
                  pending by reason group; call outs by priority with SLA met
                  or missed; contracts at risk; technician utilisation;
                  allowance use; access failures by community. For the period.
    Commercial    DEV-412: proposals and conversion, discounts by level,
                  signed value by period and category, collections and
                  ageing, cheques by status, additional-work revenue,
                  renewals. DEV-502: lost AMCs, new against renewed,
                  coordinators. For the period.

  One card per topic, a chart only where it says more than the figures, the
  longer lists cut to the top five, and one export for the page. Profitability
  (DEV-413) is on hold; the client report (DEV-410) is on each contract.
*/

const TOP = 5;
/** Rows a page in the View all dialog. */
const DIALOG_PAGE = 10;

/** A card that fills its grid cell, so cards side by side stand level. */
function Panel({ title, description, icon, action, children }: { title: string; description?: string; icon: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <SectionCard title={title} description={description} icon={icon} action={action} className="h-full" bodyClassName="flex flex-1 flex-col">
      {children}
    </SectionCard>
  );
}

interface Meter {
  key: string;
  title: string;
  /** The figure on the right. */
  value: ReactNode;
  /** A muted line under the title. */
  detail?: string;
  /** A thin bar under the title, 0 to 100 (more is capped and shown in the attention colour). */
  percent?: number | null;
  tone?: "brand" | "good" | "progress" | "attention";
  href?: string;
}

/**
 * A list as rows (25 Nov 2026): the name and its figure on one line, a thin
 * bar where there is a share, a muted line of detail. Fits any card width,
 * where a table scrolled sideways in a narrow card. The top five, and how
 * many more.
 */
function MeterRows({ items, empty, all = false, icon }: { items: Meter[]; empty: string; all?: boolean; icon?: ReactNode }) {
  if (!items.length) return <Empty icon={icon}>{empty}</Empty>;
  return (
    <div className="flex flex-1 flex-col px-5 pb-5">
      <ul className="divide-y">
        {(all ? items : items.slice(0, TOP)).map((m) => {
          const over = m.percent != null && m.percent > 100;
          const color = over ? SERIES.attention : SERIES[m.tone ?? "brand"];
          const body = (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <TruncatedText text={m.title} className="text-sm font-medium" />
                <span className="shrink-0 text-sm font-semibold tabular-nums">{m.value}</span>
              </div>
              {m.percent != null ? (
                <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full" role="img" aria-label={`${m.title}: ${pct(m.percent)}`}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(m.percent > 0 ? 2 : 0, m.percent))}%`, background: color }} />
                </div>
              ) : null}
              {m.detail ? <TruncatedText text={m.detail} className="text-muted-foreground mt-1 text-xs" /> : null}
            </>
          );
          return (
            <li key={m.key} className="py-2.5 first:pt-0 last:pb-0">
              {m.href ? (
                <Link href={m.href} className="hover:bg-muted/40 -mx-2 block rounded-md px-2 py-0.5">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A card listing the top five, with View all in its header when there are
 * more (25 Nov 2026, the user: as Snagging's "Snags by category"). View all
 * opens every row in a dialog, the same rows as the card, so it reads as
 * more of the same list.
 */
function ListPanel({
  title,
  description,
  icon,
  items,
  empty,
  more,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  items: Meter[];
  empty: string;
  /** What the rows are, for the dialog's count: "allowances", "technicians". */
  more?: string;
}) {
  const [open, setOpen] = useState(false);
  /* Pages of ten in the dialog (25 Nov 2026): a list can grow past what one screen holds. */
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / DIALOG_PAGE));
  const at = Math.min(page, pages - 1);
  const shown = items.slice(at * DIALOG_PAGE, at * DIALOG_PAGE + DIALOG_PAGE);
  return (
    <>
      <Panel
        title={title}
        description={description}
        icon={icon}
        action={
          items.length > TOP ? (
            <Button
              variant="outline"
              size="sm"
              className="whitespace-nowrap"
              onClick={() => {
                setPage(0);
                setOpen(true);
              }}
            >
              View all {items.length}
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          ) : undefined
        }
      >
        <MeterRows items={items} empty={empty} icon={icon} />
      </Panel>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton>
          <DialogHeader className="px-6 pt-6 pb-4 text-left">
            <DialogTitle className="pr-10 text-lg">{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="border-y px-6 py-3">
            <p className="text-muted-foreground text-sm">{`${items.length} ${more ?? "in all"}`}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 py-4">
            <MeterRows items={shown} empty={empty} all icon={icon} />
          </div>
          {pages > 1 ? (
            <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
              <p className="text-muted-foreground text-sm tabular-nums">
                {at * DIALOG_PAGE + 1}–{Math.min(items.length, (at + 1) * DIALOG_PAGE)} of {items.length}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={at === 0} onClick={() => setPage(at - 1)} aria-label="Previous page">
                  <ChevronLeft className="size-4" aria-hidden />
                  Previous
                </Button>
                <span className="text-muted-foreground text-sm tabular-nums">
                  Page {at + 1} of {pages}
                </span>
                <Button variant="outline" size="sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} aria-label="Next page">
                  Next
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Nothing to show (25 Nov 2026): a dashed box with the card's icon and the message, filling the card. */
function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mx-5 mb-5 flex min-h-36 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center">
      <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-lg [&_svg]:size-5" aria-hidden>
        {icon ?? <ListChecks />}
      </span>
      <p className="text-muted-foreground max-w-xs text-sm">{children}</p>
    </div>
  );
}

export function AmcReportsOverview() {
  const [period, setPeriod] = useState<ReportPeriod>(defaultReportPeriod);
  const dash = useAmcData(() => insightsService.dashboard(), "amc-dashboard");
  const ops = useAmcData(() => insightsService.operational(period.from, period.to), `ops:${period.from}:${period.to}`);
  const com = useAmcData(() => insightsService.commercial(period.from, period.to), `com:${period.from}:${period.to}`);
  const d = dash.data?.dashboard ?? null;
  const o = ops.data?.report ?? null;
  const c = com.data?.report ?? null;

  return (
    <div className="flex flex-col gap-8">
      {/* The Export inside the period bar, level with its pickers (25 Nov 2026). */}
      <PeriodPicker
        value={period}
        onChange={setPeriod}
        actions={d && o && c ? <ReportExportMenu d={d} o={o} c={c} period={period} /> : null}
      />

      <section className="flex flex-col gap-3">
        <SubHeading>At a glance · today</SubHeading>
        {dash.error ? <ErrorState title="Could not load the figures" message={dash.error} onRetry={dash.reload} /> : d ? <Glance d={d} /> : <StatGridSkeleton count={8} />}
      </section>

      <section className="flex flex-col gap-3">
        <SubHeading>{`Operations · ${dayLabel(period.from)} to ${dayLabel(period.to)}`}</SubHeading>
        {ops.error ? <ErrorState title="Could not load the operations figures" message={ops.error} onRetry={ops.reload} /> : o ? <Operations r={o} /> : <ReportSkeleton sections={2} />}
      </section>

      <section className="flex flex-col gap-3">
        <SubHeading>{`Commercial · ${dayLabel(period.from)} to ${dayLabel(period.to)}`}</SubHeading>
        {com.error ? <ErrorState title="Could not load the commercial figures" message={com.error} onRetry={com.reload} /> : c ? <Commercial r={c} /> : <ReportSkeleton sections={2} />}
      </section>
    </div>
  );
}

/* DEV-414: eight figures, today. */
function Glance({ d }: { d: ManagementDashboard }) {
  const proposals = (key: string) => d.pipeline.proposalsByStatus.find((p) => p.key === key)?.count ?? 0;
  const [r30, r60, r90] = [30, 60, 90].map((days) => d.renewals.find((r) => r.days === days));
  return (
    <StatCardGrid columns={4}>
      <StatCard label="Open enquiries" value={d.pipeline.openEnquiries} headline={`${proposals("proposal_sent") + proposals("contract_sent")} proposals with the client`} caption="Pipeline" href={`${BASE}/enquiries`} />
      <StatCard
        label="Waiting for approval"
        value={d.approvals.pendingProposalSteps}
        headline={`${d.approvals.jobSheetsAwaitingReview} job sheets to review`}
        caption="Approvals"
        tone={d.approvals.pendingProposalSteps ? "review" : "neutral"}
      />
      <StatCard label="Active contracts" value={d.contracts.active} headline={formatCurrencyAED(d.contracts.activeValue)} caption="Contracts · value incl. VAT" href={`${BASE}?status=active`} />
      <StatCard
        label="Renewals due"
        value={r30?.count ?? 0}
        headline={`${r60?.count ?? 0} in 60 days · ${r90?.count ?? 0} in 90 days`}
        caption="Ending within 30 days"
        tone={r30 && r30.count > r30.started ? "progress" : "neutral"}
        href={`${BASE}/renewals`}
      />
      <StatCard
        label="Overdue visits"
        value={d.delivery.overdueVisits}
        headline={`${d.delivery.visitsDueThisWeek} due this week · ${d.delivery.pendingAccess} pending access`}
        caption="Delivery"
        tone={d.delivery.overdueVisits ? "bad" : "neutral"}
        href={`${BASE}/visits`}
      />
      <StatCard
        label="Open call outs"
        value={d.delivery.openCallOuts}
        headline={`${d.delivery.slaMissed} past the SLA · ${d.delivery.openEmergencies} emergencies`}
        caption="Delivery"
        tone={d.delivery.slaMissed ? "bad" : "neutral"}
      />
      <StatCard
        label="Technician utilisation"
        value={pct(d.workforce.utilisationNext7Days)}
        headline={`${formatQuantity(d.workforce.bookedHoursNext7Days)} h booked · ${d.workforce.activeTechnicians} technicians`}
        caption="Workforce · next 7 days"
        tone={d.workforce.utilisationNext7Days !== null && d.workforce.utilisationNext7Days > 100 ? "bad" : "neutral"}
      />
      <StatCard
        label="Overdue payments"
        value={<Money value={d.commercial.overdue} className="text-xl" />}
        headline={`${formatCurrencyAED(d.commercial.collectedThisMonth)} collected this month`}
        caption="Commercial"
        tone={d.commercial.overdue > 0 ? "bad" : "neutral"}
        href={`${BASE}/payments`}
      />
    </StatCardGrid>
  );
}

/* DEV-411. */
function Operations({ r }: { r: OperationalReport }) {
  const { adherence: a, backlog: b } = r;
  const reasons = REASON_GROUPS.map((g) => ({ name: OUTCOME_GROUPS[g].label, count: b.byReasonGroup[g] ?? 0 })).filter((x) => x.count > 0);
  const busy = r.utilisation.filter((x) => x.jobs > 0 || x.bookedHours > 0).sort((x, y) => (y.percent ?? 0) - (x.percent ?? 0));
  const allowances = r.allowances.filter((x) => x.percent !== null).sort((x, y) => (y.percent ?? 0) - (x.percent ?? 0));
  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-stretch gap-6 lg:grid-cols-3">
        <Panel title="Schedule adherence" description="Visits done in the period inside their service window." icon={<CalendarCheck />}>
          <div className="px-5 pb-2">
            <ShareRing value={a.done ? a.percent : null} label={`Within the window, ${a.within} of ${a.done}`} tone={a.percent !== null && a.percent >= 90 ? "good" : "brand"} />
          </div>
          <Figures className="sm:grid-cols-2 xl:grid-cols-2" items={[
            { label: "Early", value: a.early },
            { label: "Late", value: a.late, tone: a.late ? "bad" : undefined },
          ]} />
        </Panel>
        <Panel title="Visits" description="Open today, and trades not done in the period by reason." icon={<CalendarClock />}>
          <Figures className="sm:grid-cols-2 xl:grid-cols-2" items={[
            { label: "Due now", value: b.due },
            { label: "Overdue", value: b.overdue, tone: b.overdue ? "bad" : undefined },
            { label: "Pending access", value: b.pendingAccess, tone: b.pendingAccess ? "warn" : undefined },
            { label: "Not completed", value: b.notCompleted },
          ]} />
          {reasons.length ? <div className="px-5 pb-5"><ShareRows rows={reasons} total={reasons.reduce((s, x) => s + x.count, 0)} /></div> : null}
        </Panel>
        <ListPanel title="Call outs" description="Reported in the period: the share that met the response target." icon={<PhoneCall />}
          empty="No call outs in this period."
          items={r.callOuts.map((x) => ({
              key: x.priority,
              title: priorityLabel(x.priority),
              value: x.total ? `${pct(x.metPercent)} met` : "—",
              percent: x.metPercent,
              tone: x.missed ? "attention" : "good",
              detail: `${plural(x.total, "call out")} · ${x.missed} missed · ${x.open} open · ${x.covered} covered · ${x.chargeable} chargeable`,
            }))}
        />
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <ListPanel title="Contracts at risk" description="Visits overdue, or more left than the time allows." icon={<AlertTriangle />}
          empty="No contract is at risk of ending incomplete."
          more="at risk"
            items={r.atRisk.map((x) => ({
              key: x.contractId,
              title: `${x.number || "Contract"} · ${x.customerName}`,
              /* The days left as the figure; the reasons already say the visits left and overdue. */
              value: `${plural(x.daysLeft, "day")} left`,
              detail: x.reasons.join(" · ") || `${plural(x.remaining, "visit")} left`,
              href: `${BASE}/${x.contractId}`,
            }))}
        />
        <ListPanel title="Technician utilisation" description={`AMC work booked, against ${plural(r.workingDays, "working day")} of 8 hours.`} icon={<Gauge />}
          empty="No technician has AMC work in this period."
          more="technicians"
            items={busy.map((x) => ({
              key: x.fsmId,
              title: x.name,
              value: pct(x.percent),
              percent: x.percent,
              detail: `${plural(x.jobs, "job")} · ${formatQuantity(x.bookedHours)} of ${formatQuantity(x.availableHours)} h booked`,
            }))}
        />
        <ListPanel title="Allowance use" description="The allowances used the most." icon={<BarChart3 />}
          empty="No counted allowances on the contracts you can see."
          more="allowances"
            items={allowances.map((x, i) => ({
              key: `${x.contractId}-${i}`,
              title: `${x.serviceLabel} · ${x.number || "Contract"}`,
              value: `${pct(x.percent)} used`,
              percent: x.percent,
              tone: (x.percent ?? 0) >= 100 ? "attention" : (x.percent ?? 0) >= 80 ? "progress" : "brand",
              detail: `${formatQuantity(x.used)} of ${formatQuantity(x.included ?? 0)} ${x.entitlementType === "hours" ? "hours" : "visits"} used · ${formatQuantity(x.remaining ?? 0)} left · ${x.customerName}`,
              href: `${BASE}/${x.contractId}`,
            }))}
        />
        <ListPanel title="Access failures" description="Trades not done for want of access, by community." icon={<MapPin />}
          empty="No access failures recorded."
          more="communities"
            items={r.accessFailures.map((x) => ({
              key: x.community,
              title: x.community,
              value: plural(x.total, "trade"),
              detail: `${x.access} refused by the community or building · ${x.noAccessGiven} with no access from the client`,
            }))}
        />
      </div>
    </div>
  );
}

/* DEV-412 and DEV-502. */
function Commercial({ r }: { r: CommercialReport }) {
  const { enquiries: e, proposals: p, additionalWork: w, renewals: n, newVsRenewed: nv } = r;
  const won = e.bySource.reduce((s, x) => s + x.won, 0);
  const lost = e.bySource.reduce((s, x) => s + x.lost, 0);
  const owedTotal = r.ageing.reduce((s, x) => s + x.amount, 0);
  const chequeTotal = r.cheques.reduce((s, x) => s + x.amount, 0);
  const discountCount = r.discounts.reduce((s, x) => s + x.count, 0);
  const ageingRows = [...r.ageing].sort((x, y) => AGEING_BUCKETS.indexOf(x.bucket as (typeof AGEING_BUCKETS)[number]) - AGEING_BUCKETS.indexOf(y.bucket as (typeof AGEING_BUCKETS)[number]));
  const collected = r.collections.reduce((s, x) => s + x.amount, 0);
  /* One month signed reads better as its categories than as one column (25 Nov 2026). */
  const sumOf = (k: "residential" | "commercial" | "unknown") => r.signedValue.reduce((s, x) => s + x[k], 0);
  const signedTotal = sumOf("residential") + sumOf("commercial") + sumOf("unknown");
  const signedCount = r.signedValue.reduce((s, x) => s + x.count, 0);
  const categoryRows: Meter[] = (
    [
      ["residential", "Residential", "brand"],
      ["commercial", "Commercial", "progress"],
      ["unknown", "Category not recorded", "brand"],
    ] as const
  )
    .map(([k, title, tone]) => ({ k, title, tone, value: sumOf(k) }))
    .filter((x) => x.value > 0)
    .map((x) => ({
      key: x.k,
      title: x.title,
      value: formatCurrencyAED(x.value),
      percent: signedTotal ? (x.value / signedTotal) * 100 : 0,
      tone: x.tone,
      detail: `${pct(signedTotal ? (x.value / signedTotal) * 100 : 0)} of ${formatCurrencyAED(signedTotal)} signed · ${plural(signedCount, "contract")} in all`,
    }));
  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <Panel title="Proposals and conversion" description="Created in the period; rates are of those sent to the client." icon={<ClipboardList />}>
          <div className="px-5 pb-3">
            <FunnelBars
              steps={[
                { label: "Created", value: p.created },
                { label: "Sent", value: p.sent },
                { label: "Accepted", value: p.accepted },
                { label: "Signed", value: p.signed, tone: "good" },
              ]}
            />
          </div>
          <Figures className="mt-auto sm:grid-cols-3 xl:grid-cols-3" items={[
            { label: "Value signed", value: <Money value={p.signedValue} className="text-xl" />, hint: "Before VAT" },
            { label: "Enquiries", value: e.total, hint: `${won} won · ${lost} lost` },
            { label: "In approval", value: p.inApproval, hint: p.rejected ? `${p.rejected} rejected` : "None rejected" },
          ]} />
        </Panel>
        <Panel title="Signed value" description="Contracts signed in the period by month and category, incl. VAT." icon={<TrendingUp />}>
          {r.signedValue.length === 1 || (r.signedValue.length > 1 && signedTotal === 0) ? (
            <MeterRows
              empty="No contract signed in this period."
              icon={<TrendingUp />}
              items={categoryRows}
            />
          ) : r.signedValue.length ? (
            <div className="px-5 pb-3">
              <ReportBars
                data={r.signedValue}
                categoryKey="month"
                categoryLabel={monthLabel}
                stacked
                money
                height={200}
                series={[
                  { key: "residential", label: "Residential", color: SERIES.brand },
                  { key: "commercial", label: "Commercial", color: SERIES.neutral },
                  { key: "unknown", label: "Not recorded", color: SERIES.neutralSoft },
                ]}
              />
            </div>
          ) : (
            <Empty icon={<TrendingUp />}>No contract signed in this period.</Empty>
          )}
          <Figures className="mt-auto" items={[
            { label: "New", value: nv.new.count, hint: formatCurrencyAED(nv.new.value) },
            { label: "Renewed", value: nv.renewed.count, hint: formatCurrencyAED(nv.renewed.value) },
            { label: "Lost AMCs", value: r.lost.count, hint: formatCurrencyAED(r.lost.value), tone: r.lost.count ? "warn" : undefined },
            { label: "Renewal rate", value: pct(n.ending ? n.renewalRate : null), hint: `${n.renewed} of ${n.ending} ending` },
          ]} />
        </Panel>
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-3">
        <ListPanel title="Collections and ageing" description={`${formatCurrencyAED(collected)} received in the period; what is owed today by days past due.`} icon={<Wallet />}
          empty="Nothing owed."
          items={owedTotal > 0
              ? ageingRows.map((x) => ({
                  key: x.bucket,
                  title: x.bucket === "Not due" ? "Not due yet" : `${x.bucket} days past due`,
                  value: formatCurrencyAED(x.amount),
                  percent: owedTotal ? (x.amount / owedTotal) * 100 : 0,
                  tone: x.bucket === "Not due" ? "good" : x.bucket === "1-30" ? "progress" : "attention",
                  detail: plural(x.count, "instalment"),
                }))
              : []}
        />
        <ListPanel title="Cheques" description="Every cheque, by status." icon={<ReceiptText />}
          empty="No cheques recorded."
          /* Only the statuses that hold a cheque: four rows of AED 0.00 said nothing. */
            items={r.cheques.filter((x) => x.count > 0).map((x) => ({
              key: x.status,
              title: CHEQUE_STATUS_LABELS[x.status as ChequeStatus] ?? humanize(x.status),
              value: formatCurrencyAED(x.amount),
              percent: chequeTotal ? (x.amount / chequeTotal) * 100 : 0,
              tone: x.status === "bounced" ? "attention" : x.status === "cleared" ? "good" : "brand",
              detail: plural(x.count, "cheque"),
            }))}
        />
        <ListPanel title="Discounts by level" description="Proposals created in the period, by the level their discount needs." icon={<Percent />}
          empty="No proposals in this period."
          items={r.discounts.map((x) => ({
              key: String(x.level),
              title: x.name,
              value: plural(x.count, "proposal"),
              percent: discountCount ? (x.count / discountCount) * 100 : 0,
              detail: `${pct(x.averageDiscount)} average discount · ${formatCurrencyAED(x.value)}`,
            }))}
        />
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <Panel title="Additional work" description="Raised in the period, by how far it got. Incl. VAT." icon={<Wrench />}>
          <Figures className="sm:grid-cols-3 xl:grid-cols-3" items={[
            { label: "Raised", value: w.raised },
            { label: "Approved", value: <Money value={w.approved} className="text-xl" />, hint: `${pct(w.approvalRate)} approval rate` },
            { label: "Paid", value: <Money value={w.paid} className="text-xl" />, hint: `${formatCurrencyAED(w.invoiced)} invoiced` },
          ]} />
        </Panel>
        <ListPanel title="Coordinators" description="Each owner's period: enquiries, contracts signed and lost." icon={<Users />}
          empty="Nothing in this period."
          more="coordinators"
            items={r.coordinators.map((x) => ({
              key: x.ownerId || "unassigned",
              title: x.owner || "Unassigned",
              value: `${x.signed} signed`,
              detail: `${x.enquiries} ${x.enquiries === 1 ? "enquiry" : "enquiries"} · ${pct(x.winRate)} won · ${formatCurrencyAED(x.signedValue)} signed · ${x.renewed} renewed · ${x.lost} lost`,
            }))}
        />
      </div>
    </div>
  );
}

/*
  The page's one export (25 Nov 2026): a workbook laid out like the page.
  Summary sheet: the title, the period and when it was exported, then At a
  glance, Operations and Commercial as blocks of Measure, Value, Unit. Then
  a sheet for each list (contracts at risk, allowances, coordinators...),
  every row of it with its own headings. The CSV holds the same blocks, one
  after another.
*/
type SummaryLine = { measure: string; value: CellValue; unit?: "AED" | "%" | ""; note?: string };
const SUMMARY_COLUMNS: ExportColumn[] = [
  { key: "measure", label: "Measure" },
  { key: "value", label: "Value" },
  { key: "unit", label: "Unit" },
  { key: "note", label: "Note" },
];
const summaryBlock = (title: string, lines: SummaryLine[]): ReportBlock => ({
  sheet: "Summary",
  title,
  columns: SUMMARY_COLUMNS,
  rows: lines.map((l) => ({ measure: l.measure, value: l.value ?? "", unit: l.unit ?? "", note: l.note ?? "" })),
  formatOf: (row, key) => (key !== "value" ? null : row.unit === "AED" ? "money" : row.unit === "%" ? "percent" : null),
});

function reportBlocks(d: ManagementDashboard, o: OperationalReport, c: CommercialReport): ReportBlock[] {
  const collected = c.collections.reduce((s, x) => s + x.amount, 0);
  return [
    summaryBlock("At a glance (today)", [
      { measure: "Open enquiries", value: d.pipeline.openEnquiries },
      { measure: "Proposal approvals waiting", value: d.approvals.pendingProposalSteps },
      { measure: "Job sheets awaiting review", value: d.approvals.jobSheetsAwaitingReview },
      { measure: "Active contracts", value: d.contracts.active },
      { measure: "Active contract value", value: d.contracts.activeValue, unit: "AED", note: "Incl. VAT" },
      ...d.renewals.map((x) => ({ measure: `Contracts ending within ${x.days} days`, value: x.count, note: `${x.started} with a renewal started` })),
      { measure: "Overdue visits", value: d.delivery.overdueVisits },
      { measure: "Visits due this week", value: d.delivery.visitsDueThisWeek },
      { measure: "Visits pending access", value: d.delivery.pendingAccess },
      { measure: "Open call outs", value: d.delivery.openCallOuts, note: `${d.delivery.openEmergencies} emergencies` },
      { measure: "Call outs past the SLA", value: d.delivery.slaMissed },
      { measure: "Technician utilisation, next 7 days", value: d.workforce.utilisationNext7Days, unit: "%" },
      { measure: "Collected this month", value: d.commercial.collectedThisMonth, unit: "AED" },
      { measure: "Overdue payments", value: d.commercial.overdue, unit: "AED" },
    ]),
    summaryBlock("Operations (the period)", [
      { measure: "Visits done", value: o.adherence.done },
      { measure: "Done within the service window", value: o.adherence.percent, unit: "%", note: `${o.adherence.early} early, ${o.adherence.late} late` },
      { measure: "Visits due now", value: o.backlog.due },
      { measure: "Visits overdue", value: o.backlog.overdue },
      { measure: "Visits pending access", value: o.backlog.pendingAccess },
      { measure: "Visits not completed", value: o.backlog.notCompleted },
      ...o.callOuts.map((x) => ({ measure: `${priorityLabel(x.priority)} call outs, SLA met`, value: x.metPercent, unit: "%" as const, note: `${x.total} reported, ${x.missed} missed` })),
      { measure: "Contracts at risk", value: o.atRisk.length },
    ]),
    summaryBlock("Commercial (the period)", [
      { measure: "Enquiries received", value: c.enquiries.total },
      { measure: "Proposals created", value: c.proposals.created },
      { measure: "Proposals sent", value: c.proposals.sent },
      { measure: "Proposals signed", value: c.proposals.signed, note: `${pct(c.proposals.signedRate)} of those sent` },
      { measure: "Value signed", value: c.proposals.signedValue, unit: "AED", note: "Before VAT" },
      { measure: "New contracts", value: c.newVsRenewed.new.count, note: formatCurrencyAED(c.newVsRenewed.new.value) },
      { measure: "Renewals", value: c.newVsRenewed.renewed.count, note: formatCurrencyAED(c.newVsRenewed.renewed.value) },
      { measure: "Lost AMCs", value: c.lost.count, note: formatCurrencyAED(c.lost.value) },
      { measure: "Renewal rate", value: c.renewals.ending ? c.renewals.renewalRate : null, unit: "%", note: `${c.renewals.renewed} of ${c.renewals.ending} ending` },
      { measure: "Collected", value: collected, unit: "AED" },
      { measure: "Additional work approved", value: c.additionalWork.approved, unit: "AED", note: `${c.additionalWork.raised} raised` },
      { measure: "Additional work paid", value: c.additionalWork.paid, unit: "AED" },
    ]),
    {
      sheet: "Call outs",
      title: "Call outs by priority",
      columns: [
        { key: "priority", label: "Priority" },
        { key: "total", label: "Reported" },
        { key: "met", label: "SLA met" },
        { key: "missed", label: "SLA missed" },
        { key: "metPercent", label: "Met" },
        { key: "open", label: "Open" },
        { key: "covered", label: "Covered" },
        { key: "chargeable", label: "Chargeable" },
      ],
      rows: o.callOuts.map((x) => ({ ...x, priority: priorityLabel(x.priority) })),
      percent: ["metPercent"],
    },
    {
      sheet: "Contracts at risk",
      title: "Contracts at risk of ending incomplete",
      columns: [
        { key: "number", label: "Contract" },
        { key: "customerName", label: "Client" },
        { key: "propertyLabel", label: "Property" },
        { key: "endDate", label: "Ends" },
        { key: "daysLeft", label: "Days left" },
        { key: "remaining", label: "Visits left" },
        { key: "overdue", label: "Overdue" },
        { key: "why", label: "Why" },
      ],
      rows: o.atRisk.map((x) => ({ ...x, reasons: undefined, why: x.reasons.join("; ") })),
    },
    {
      sheet: "Utilisation",
      title: "Technician utilisation (AMC work)",
      columns: [
        { key: "name", label: "Technician" },
        { key: "jobs", label: "Jobs" },
        { key: "bookedHours", label: "Booked hours" },
        { key: "availableHours", label: "Available hours" },
        { key: "percent", label: "Utilisation" },
      ],
      rows: o.utilisation.filter((x) => x.jobs > 0 || x.bookedHours > 0),
      percent: ["percent"],
    },
    {
      sheet: "Allowance use",
      title: "Allowance use",
      columns: [
        { key: "number", label: "Contract" },
        { key: "customerName", label: "Client" },
        { key: "serviceLabel", label: "Service" },
        { key: "unit", label: "Unit" },
        { key: "included", label: "Included" },
        { key: "used", label: "Used" },
        { key: "reserved", label: "Booked" },
        { key: "remaining", label: "Remaining" },
        { key: "percent", label: "Used share" },
        { key: "chargeableCallOuts", label: "Chargeable call outs" },
      ],
      rows: o.allowances.map((x) => ({ ...x, unit: x.entitlementType === "hours" ? "Hours" : "Visits" })),
      percent: ["percent"],
    },
    {
      sheet: "Access failures",
      title: "Access failures by community",
      columns: [
        { key: "community", label: "Community" },
        { key: "access", label: "Refused by community or building" },
        { key: "noAccessGiven", label: "No access from the client" },
        { key: "total", label: "Total" },
      ],
      rows: o.accessFailures,
    },
    {
      sheet: "Signed value",
      title: "Signed value by month (incl. VAT)",
      columns: [
        { key: "month", label: "Month" },
        { key: "count", label: "Contracts" },
        { key: "residential", label: "Residential" },
        { key: "commercial", label: "Commercial" },
        { key: "unknown", label: "Not recorded" },
        { key: "total", label: "Total" },
      ],
      rows: c.signedValue.map((x) => ({ ...x, month: monthLabel(x.month) })),
      money: ["residential", "commercial", "unknown", "total"],
    },
    {
      sheet: "Payments",
      title: "Collections by month",
      columns: [
        { key: "month", label: "Month" },
        { key: "amount", label: "Received (AED)" },
      ],
      rows: c.collections.map((x) => ({ ...x, month: monthLabel(x.month) })),
      money: ["amount"],
    },
    {
      sheet: "Payments",
      title: "Ageing: owed today by days past due",
      columns: [
        { key: "bucket", label: "Days past due" },
        { key: "count", label: "Instalments" },
        { key: "amount", label: "Owed (AED)" },
      ],
      rows: [...c.ageing]
        .sort((x, y) => AGEING_BUCKETS.indexOf(x.bucket as (typeof AGEING_BUCKETS)[number]) - AGEING_BUCKETS.indexOf(y.bucket as (typeof AGEING_BUCKETS)[number]))
        .map((x) => ({ ...x, bucket: x.bucket === "Not due" ? "Not due yet" : `${x.bucket} days` })),
      money: ["amount"],
    },
    {
      sheet: "Payments",
      title: "Cheques by status",
      columns: [
        { key: "status", label: "Status" },
        { key: "count", label: "Cheques" },
        { key: "amount", label: "Amount (AED)" },
      ],
      rows: c.cheques.map((x) => ({ ...x, status: CHEQUE_STATUS_LABELS[x.status as ChequeStatus] ?? humanize(x.status) })),
      money: ["amount"],
    },
    {
      sheet: "Proposals",
      title: "Discounts by approval level",
      columns: [
        { key: "name", label: "Approval level" },
        { key: "count", label: "Proposals" },
        { key: "value", label: "Value (AED)" },
        { key: "averageDiscount", label: "Average discount" },
      ],
      rows: c.discounts,
      money: ["value"],
      percent: ["averageDiscount"],
    },
    {
      sheet: "Proposals",
      title: "Lost AMCs",
      columns: [
        { key: "number", label: "Contract" },
        { key: "customerName", label: "Client" },
        { key: "value", label: "Value (AED)" },
        { key: "outcome", label: "Outcome" },
        { key: "reason", label: "Reason" },
        { key: "at", label: "Recorded" },
      ],
      rows: c.lost.rows.map((x) => ({ ...x, outcome: x.outcome === "lapsed" ? "Lapsed" : "Not renewed", at: x.at.slice(0, 10) })),
      money: ["value"],
    },
    {
      sheet: "Coordinators",
      title: "Coordinators",
      columns: [
        { key: "owner", label: "Coordinator" },
        { key: "enquiries", label: "Enquiries" },
        { key: "won", label: "Won" },
        { key: "winRate", label: "Win rate" },
        { key: "proposals", label: "Proposals" },
        { key: "sent", label: "Sent" },
        { key: "signed", label: "Signed" },
        { key: "signedValue", label: "Value signed (AED)" },
        { key: "renewed", label: "Renewed" },
        { key: "lost", label: "Lost" },
      ],
      rows: c.coordinators.map((x) => ({ ...x, owner: x.owner || "Unassigned" })),
      money: ["signedValue"],
      percent: ["winRate"],
    },
  ];
}

/** Export: the report as a workbook or a CSV, laid out like the page. */
function ReportExportMenu({ d, o, c, period }: { d: ManagementDashboard; o: OperationalReport; c: CommercialReport; period: ReportPeriod }) {
  const run = async (format: "csv" | "xlsx") => {
    try {
      await exportReport({
        title: "AMC report",
        lines: [
          `Period: ${dayLabel(period.from)} to ${dayLabel(period.to)} (At a glance is as of today)`,
          `Exported: ${dayLabel(todayInDubai())}`,
          "From contract data only. Draft or rejected proposals and quotes are never counted as revenue.",
        ],
        blocks: reportBlocks(d, o, c),
        filename: `amc-report-${period.from}-to-${period.to}`,
        format,
      });
    } catch {
      toast.error("Could not create the file.");
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="size-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void run("xlsx")}>Excel (a sheet per list)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run("csv")}>CSV</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
