"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  ArrowLeft,
  Banknote,
  Check,
  Copy,
  FileSignature,
  FileText,
  FileUp,
  Gauge,
  History,
  ListChecks,
  ChevronDown,
  Pause,
  PenLine,
  Play,
  Plus,
  Power,
  ReceiptText,
  RefreshCw,
  SearchX,
  Send,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import {
  SectionCard,
  StatCard,
  StatCardGrid,
  SubHeading,
  TabCount,
} from "@/components/dashboard/shared/kaizen";
import {
  ErrorState,
  SectionSkeleton,
  StatGridSkeleton,
} from "@/components/dashboard/shared/kaizen-states";
import { CONTRACT_STATUS_NAMES, type ContractStatus } from "@/lib/amc/contract-lifecycle";
import { formatQuantity, unitWord } from "@/lib/amc/contracts";
import { AMC_VAT_PERCENT } from "@/lib/amc/pricing";
import { amcContractsService, type ContractDetail as Detail } from "@/modules/amc-contracts/amc-contracts-service";

import { SendClientReportDialog } from "./client-report-dialog";
import { ClientReportViewer } from "./client-report-viewer";
import { ContractAmendmentsPanel } from "./contract-amendments-panel";
import { PendingAmendmentsNotice } from "./pending-amendments-notice";
import { FsmClientNotice } from "./fsm-client-notice";
import { ContractCallOutsPanel } from "./contract-call-outs-panel";
import { ContractCustomer } from "./contract-customer";
import { ContractDocuments } from "./contract-documents";
import { ContractFsm } from "./contract-fsm";
import { ContractLifecycleCard, EntitlementTermsCard, useLifecycleDialogs } from "./contract-lifecycle-panel";
import { ContractPaymentsPanel, openInstalmentCount, useContractPayments } from "./contract-payments-panel";
import { ContractRenewal, RenewalReminders } from "./contract-renewal";
import { ContractSchedulePanel, scheduleHistoryEntries, useContractSchedule } from "./contract-schedule-panel";
import {
  AUDIT_LABELS,
  CALL_OUT_LABELS,
  CONTRACT_STATUS_LABELS,
  ENTITLEMENT_STATE_LABELS,
  ENTITLEMENT_TYPE_LABELS,
  contractStatusTone,
  entitlementStateTone,
  formatContractDate,
  formatDateTime,
} from "./contract-status";
import { shortDay, shortPlace } from "./detail-header";
import { contractTypeLabel } from "@/lib/amc/contract-type";
import { CoverageCheckDialog } from "./coverage-check-dialog";
import { usePaymentDialogs } from "./payment-dialogs";
import { HistoryCard, type HistoryEntry } from "./history-card";
import { useUrlTab } from "./profile/use-url-tab";
import { RecordUsageDialog } from "./record-usage-dialog";
import { UsageHistory } from "./usage-history";
import { TruncateIfText, TruncatedText } from "@/components/ui/truncated-text";
import { Fact } from "@/components/dashboard/extensions/amc/steps/review-step";
import { amcRefresh } from "@/lib/amc/http-cache";
import { useAmcData } from "./use-amc-data";
import { callOutsService } from "@/modules/amc-contracts/call-outs-service";

/* "What each service covers" on the Coverage tab: hidden for now. The terms still apply to call outs and print in the contract. */
const SHOW_ENTITLEMENT_TERMS = false;
/* Hidden for now (11 Nov 2026, the user): usage is recorded from the visits and call outs, not by hand here. Set to true to bring Record usage back. */
const SHOW_RECORD_USAGE = false;

const LIST = "/extensions/amc-contracts";

const noop = () => undefined;

type Entitlement = Awaited<ReturnType<typeof amcContractsService.get>>["entitlements"][number];

/** The Coverage tab's columns: the service, how much is used, booked by open call outs, what is left, and its state. */
function coverageColumns({ bookedFor, nearZeroFor }: { bookedFor: Map<string, number>; nearZeroFor: Set<string> }): ColumnDef<Entitlement>[] {
  const counts = (e: Entitlement) => e.entitlementType === "visits" || e.entitlementType === "hours";
  return [
    {
      id: "service",
      header: "Service",
      cell: ({ row: { original: e } }) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-medium">{e.serviceLabel}</span>
          <span className="text-muted-foreground text-xs">
            {[
              ENTITLEMENT_TYPE_LABELS[e.entitlementType],
              counts(e) || e.entitlementType === "unlimited" ? `${e.units} ${e.units === 1 ? "unit" : "units"} × ${e.entitlementType === "hours" ? `${e.frequency} h` : e.frequency} a year` : null,
              e.callOutClass ? CALL_OUT_LABELS[e.callOutClass] : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      ),
    },
    {
      id: "used",
      header: "Used",
      cell: ({ row: { original: e } }) =>
        counts(e) && e.includedQuantity !== null ? (
          <div className="grid min-w-40 gap-1.5">
            <span className="text-sm tabular-nums">
              <span className="font-medium">{formatQuantity(e.usedQuantity)}</span>
              <span className="text-muted-foreground">
                {" "}
                of {formatQuantity(e.includedQuantity)} {unitWord(e.entitlementType, e.includedQuantity)}
              </span>
            </span>
            <Progress value={e.usagePercent ?? 0} className="h-1.5 w-full max-w-40" aria-label={`${e.serviceLabel} usage`} />
          </div>
        ) : e.entitlementType === "unlimited" ? (
          <span className="text-sm">
            <span className="font-medium tabular-nums">{formatQuantity(e.usedQuantity)}</span>
            <span className="text-muted-foreground"> used · no limit</span>
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">Included, not counted</span>
        ),
    },
    {
      id: "booked",
      header: "Booked",
      cell: ({ row: { original: e } }) => {
        const booked = bookedFor.get(e.id) ?? 0;
        return <span className="text-sm tabular-nums">{booked ? formatQuantity(booked) : <span className="text-muted-foreground">—</span>}</span>;
      },
    },
    {
      id: "left",
      header: "Left",
      cell: ({ row: { original: e } }) =>
        e.remainingQuantity !== null ? (
          <span className={`font-semibold tabular-nums ${e.remainingQuantity === 0 ? "text-danger" : nearZeroFor.has(e.id) ? "text-warning" : ""}`}>
            {formatQuantity(e.remainingQuantity)} <span className="text-muted-foreground text-xs font-normal">{unitWord(e.entitlementType, e.remainingQuantity)}</span>
          </span>
        ) : e.entitlementType === "unlimited" ? (
          <span className="font-semibold">Unlimited</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "state",
      header: "State",
      cell: ({ row: { original: e } }) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className={`border-0 font-medium ${entitlementStateTone(e.state)}`}>
            {ENTITLEMENT_STATE_LABELS[e.state]}
          </Badge>
          {nearZeroFor.has(e.id) && e.remainingQuantity !== 0 ? (
            <Badge variant="secondary" className="bg-warning/10 text-warning border-0 font-medium">
              Nearly used up
            </Badge>
          ) : null}
        </span>
      ),
    },
  ];
}

/* An icon for each kind of contract event, by what it did. */
function contractEventIcon(type: string) {
  const Icon = /cancel|reject|terminat|void/.test(type)
    ? XCircle
    : /hold|pause|suspend/.test(type)
      ? Pause
      : /resum|activ|sign|approv|confirm/.test(type)
        ? CheckCircle2
        : /send|sent|share|email/.test(type)
          ? Send
          : /renew/.test(type)
            ? RefreshCw
            : /payment|invoice|paid/.test(type)
              ? ReceiptText
              : /edit|amend|update|change/.test(type)
                ? PenLine
                : History;
  return <Icon aria-hidden />;
}

/** "Ends in 30 days", "Ends today", from today in Dubai (24 Nov 2026). */
function endsInLabel(lastDay: string): string {
  const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days > 1 ? `Ends in ${days} days` : days === 1 ? "Ends tomorrow" : days === 0 ? "Ends today" : "Ended";
}

const TABS = ["overview", "coverage", "schedule", "call-outs", "usage", "fsm", "payments", "renewal", "amendments", "documents", "history"] as const;
type Tab = (typeof TABS)[number];
/* Hidden for now (10 Nov 2026): Usage (Coverage shows used and left per service) and FSM. Remove from this set to bring a tab back. */
const HIDDEN_TABS: ReadonlySet<Tab> = new Set<Tab>(["usage", "fsm"]);

/**
 * One operational AMC contract, laid out like a Snagging job: the way back
 * and Refresh, a header card with the contract's state and its next step,
 * the four figures, then tabs for its lifecycle, every service and its
 * allowance, the PPM schedule, usage, FSM, payments, renewal,
 * documents and history.
 */
export function ContractDetail({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  useBreadcrumbLabel(id, data?.contract.lifecycle?.contractNumber ?? data?.contract.proposalNumber ?? "Contract");

  /* A failed refresh keeps what is on screen; only a first load shows the error. */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await amcContractsService.get(id));
      setError(null);
      setFetchedAt(Date.now());
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the contract.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toolbar = (onRefresh: () => void) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <BackToContracts />
      <div className="flex items-center gap-3">
        {fetchedAt ? (
          <span className="text-muted-foreground hidden text-xs sm:inline">Updated {formatClock(fetchedAt)}</span>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => amcRefresh(onRefresh)} disabled={loading} aria-label="Refresh this contract">
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>
    </div>
  );

  if (!data && loading) return <ContractDetailSkeleton />;

  if (!data && error && /not found/i.test(error)) {
    return (
      <div className="flex flex-col gap-4">
        <BackToContracts />
        <Card className="p-0">
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="This contract could not be found"
            description="It may not be visible to you, or the link may be out of date."
            action={{ label: "Back to contracts", onClick: () => router.push(LIST), variant: "outline" }}
          />
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar(() => void load())}
        <ErrorState title="Could not load this contract" message={error} onRetry={() => void load()} retrying={loading} />
      </div>
    );
  }

  return <ContractView data={data} load={load} toolbar={toolbar} />;
}

function ContractView({
  data,
  load,
  toolbar,
}: {
  data: Detail;
  load: () => Promise<boolean>;
  toolbar: (onRefresh: () => void) => ReactNode;
}) {
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageFor, setUsageFor] = useState<string | null>(null);
  /* The amendment End contract asks for (DEV-417): the Amendments tab opens its request on it. */
  const [requestKind, setRequestKind] = useState<"early_termination" | "cancellation" | null>(null);
  const [checking, setChecking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [viewingReport, setViewingReport] = useState(false);
  const [usageVersion, setUsageVersion] = useState(0);
  /* Payments (Phase 7) for Finance and the owner; the tab is not offered to anyone else. */
  const canViewPayments = data.permissions.payments?.canView === true;
  const { tab, setTab, isOpened } = useUrlTab<Tab>(
    TABS.filter((t) => !HIDDEN_TABS.has(t) && (canViewPayments || t !== "payments")),
    "overview",
  );
  const payments = useContractPayments(data.contract.id, canViewPayments);
  /* The PPM schedule (Phase 8), loaded here so the tab can show what is left or overdue. */
  const schedule = useContractSchedule(data.contract.id);
  const overdueVisits = schedule.data?.progress.overdue ?? 0;
  /* Whoever operates the contract (the schedule answer says so) may send the client report; anyone who can read it may preview. */
  const canOperate = schedule.data?.permissions.canEdit === true;
  /* Money moving can move the contract too (the first instalment starts it and makes its
     schedule), so all three reload. */
  const reloadWithPayments = () => Promise.all([load(), payments.reload(), schedule.reload()]);
  const paymentDialogs = usePaymentDialogs(reloadWithPayments);
  const lifecycleDialogs = useLifecycleDialogs(data, () => void reloadWithPayments());

  /* After usage or a correction: the allowances and the history both move. */
  const reloadAll = () => {
    setUsageVersion((v) => v + 1);
    void load();
  };

  const refresh = async () => {
    setUsageVersion((v) => v + 1);
    const [ok] = await Promise.all([load(), payments.reload(), schedule.reload()]);
    if (ok) toast.success("Up to date");
    else toast.error("Could not refresh the contract. What was on screen is kept.");
  };

  const recordUsage = (entitlementId: string | null) => {
    setUsageFor(entitlementId);
    setUsageOpen(true);
  };

  const { contract, entitlements, summary, audit, source, permissions, sla, commitments } = data;
  /* The History tab: the contract's events and its schedule's changes (moved here from the Schedule tab, 11 Nov 2026), newest first. */
  /* The schedule's own record says these two better (with the visit count), so the contract's copy is left out. */
  const historyEntries: HistoryEntry[] = [
    ...audit.filter((a) => a.type !== "ppm_schedule_generated" && a.type !== "ppm_schedule_confirmed").map((a) => ({
      key: a.id,
      icon: contractEventIcon(a.type),
      title: AUDIT_LABELS[a.type] ?? a.type.replace(/_/g, " ").replace(/^\w/, (ch) => ch.toUpperCase()),
      actor: a.actor ?? null,
      detail: a.note ? `"${a.note}"` : null,
      at: a.at,
    })),
    ...scheduleHistoryEntries(schedule.data),
  ].sort((x, y) => y.at.localeCompare(x.at));
  /* Booked by open call outs and nearly used up, per service, for the Coverage tab (the call-out ledger; cached, shared with the Call outs tab). */
  const allowances = useAmcData(() => callOutsService.allowances(contract.id), `allowances:${contract.id}`);
  const bookedFor = new Map((allowances.data?.allowances ?? []).map((a) => [a.entitlementId, a.reserved]));
  const nearZeroFor = new Set((allowances.data?.allowances ?? []).filter((a) => a.nearZero).map((a) => a.entitlementId));
  const status = contract.status as ContractStatus;
  const canRecord = SHOW_RECORD_USAGE && permissions.canRecordUsage && entitlements.some((e) => e.consumable);
  const counted = summary.withRemaining + summary.exhausted;
  const paymentPerms = payments.data?.permissions ?? permissions.payments;
  /* Waiting for its first payment (DEV-386): recording it is the next step. */
  const awaitingFirst = status === "pending_initial_payment";
  const firstInstalment = awaitingFirst ? (payments.data?.gate.firstInstalment ?? null) : null;

  /*
    The header shows the step the contract is at as its one primary
    button -- sign, activate, or record usage once it is running -- with
    Check coverage beside it. Everything else waits in More, the way the
    Snagging header keeps two or three buttons in view.
  */
  const primary = permissions.canSign
    ? { label: "Sign", icon: <PenLine className="size-4" />, onClick: () => lifecycleDialogs.open("sign") }
    : permissions.canActivate
      ? { label: "Activate", icon: <Play className="size-4" />, onClick: () => lifecycleDialogs.open("activate") }
      : firstInstalment && firstInstalment.outstanding > 0 && paymentPerms?.canRecord
        ? {
          label: "Record payment",
          icon: <Banknote className="size-4" />,
          onClick: () => paymentDialogs.open(contract.id, { kind: "record_payment", instalment: firstInstalment }),
        }
        : permissions.canHold && status === "on_hold"
          ? /* The one thing to do with a held contract, beside its reason. */
          { label: "Resume", icon: <Play className="size-4" />, onClick: () => lifecycleDialogs.openStatus("active") }
          : canRecord
            ? { label: "Record usage", icon: <Plus className="size-4" />, onClick: () => recordUsage(null) }
            : null;
  const recordInMore = canRecord && primary?.label !== "Record usage";
  /* The other steps, each its own button in the header (18 Nov 2026): no More menu to open. */
  const stepButtons = [
    recordInMore ? { key: "usage", label: "Record usage", icon: <Plus className="size-4" />, onClick: () => recordUsage(null) } : null,
    permissions.canRecordScan ? { key: "scan", label: "Record signed scan", icon: <FileUp className="size-4" />, onClick: () => lifecycleDialogs.open("scan") } : null,
    permissions.canHold && status === "active" ? { key: "hold", label: "Put on hold", icon: <Pause className="size-4" />, onClick: () => lifecycleDialogs.openStatus("on_hold") } : null,
    awaitingFirst && paymentPerms?.canApprove
      ? { key: "start", label: "Start before payment", icon: <Play className="size-4" />, onClick: () => paymentDialogs.open(contract.id, { kind: "override_gate" }) }
      : null,
    /* To-do 2 (BRD 6.8): the follow-up while the client signs or pays can wait a few days. */
    permissions.canEditTerms && (status === "pending_client_signature" || awaitingFirst)
      ? { key: "snooze", label: "Snooze follow-up", icon: <AlarmClock className="size-4" />, onClick: () => lifecycleDialogs.open("snooze") }
      : null,
  ].filter((b): b is NonNullable<typeof b> => b !== null);
  /*
    DEV-417: ending a contract goes through the Amendments tab -- an early
    termination for an active contract, a cancellation before it starts --
    so its reason, dates and refund are kept. One approver is enough (26 Nov
    2026): an AMC approver ends it there in one step; anyone else asks and
    one approver decides.
  */
  const askToEnd = (kind: "early_termination" | "cancellation") => {
    setRequestKind(kind);
    setTab("amendments");
  };
  const endItems = [
    permissions.canTerminate ? (
      <DropdownMenuItem key="terminate" variant="destructive" onClick={() => askToEnd("early_termination")}>
        <Power className="size-4" />
        End contract early
      </DropdownMenuItem>
    ) : null,
    permissions.canCallOff ? (
      <DropdownMenuItem key="calloff" variant="destructive" onClick={() => askToEnd("cancellation")}>
        <XCircle className="size-4" />
        Cancel contract
      </DropdownMenuItem>
    ) : null,
  ].filter(Boolean);

  /* The one thing about this contract worth reading before anything else. */
  const attention: { tone: "danger" | "warning" | "info"; title: string; body: string } | null =
    data.ending
      ? {
        tone: "danger",
        title: `Ending ${formatContractDate(data.ending.effectiveOn)}: early termination`,
        body: `${data.ending.noticeOn ? `Notice given ${formatContractDate(data.ending.noticeOn)}. ` : ""}The contract runs until then and visits before that day go ahead; visits after it are cancelled.${data.ending.refund ? ` Refund for the unused part: AED ${data.ending.refund.toLocaleString("en-AE", { minimumFractionDigits: 2 })}.` : " No refund."} It cannot be put on hold, renewed or changed again.`,
      }
      : contract.status === "cancelled"
      ? {
        tone: "danger",
        title: `Cancelled ${formatDateTime(contract.cancelledAt)}`,
        body: `${contract.cancellationReason ? `${contract.cancellationReason}. ` : ""}Coverage has stopped and no new usage can be recorded. Usage already recorded stays on the Usage tab.`,
      }
      : contract.displayStatus === "expired"
        ? {
          tone: "danger",
          title: `Ended ${formatContractDate(contract.endDate)}`,
          body: "Work after that date is chargeable unless the contract is renewed.",
        }
        : awaitingFirst
          ? {
            tone: "warning",
            title: "Waiting for its first payment",
            body: firstInstalment
              ? `Instalment 1 (AED ${firstInstalment.outstanding.toLocaleString("en-AE", { minimumFractionDigits: 2 })}) is due ${formatContractDate(firstInstalment.dueDate)}. No visits are released until it is received.`
              : "No visits are released until the first instalment is received.",
          }
          : contract.lifecycle?.statusReason
            ? {
              tone: status === "terminated" ? "danger" : "warning",
              title: CONTRACT_STATUS_NAMES[status] ?? status,
              body: contract.lifecycle.statusReason,
            }
            : status === "signed"
              ? {
                tone: "info",
                title: `Signed ${contract.signedAt ? formatDateTime(contract.signedAt) : ""}`.trim(),
                body: `${contract.lifecycle?.signatureRoute === "scan" && contract.lifecycle.signedScanDate ? `Scan dated ${formatContractDate(contract.lifecycle.signedScanDate)}. ` : ""}Activate it with the commencement date: visits and coverage start from then.`,
              }
              : contract.displayStatus === "not_started"
                ? {
                  tone: "info",
                  title: `Coverage starts on ${formatContractDate(contract.startDate)}`,
                  body: "Usage can be recorded from then.",
                }
                : null;

  /* A tab's body, mounted on first open and kept after. */
  const panel = (value: Tab, children: ReactNode) =>
    isOpened(value) ? (
      <TabsContent value={value} forceMount className="mt-4 flex flex-col gap-6 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      {toolbar(() => void refresh())}

      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {contract.lifecycle?.contractNumber ? <Badge variant="outline">Contract {contract.lifecycle.contractNumber}</Badge> : null}
              <Badge variant="outline">Proposal {contract.proposalNumber}</Badge>
              {contract.lifecycle?.template ? (
                <Badge variant="outline">{contract.lifecycle.template === "commercial" ? "Commercial" : "Residential"}</Badge>
              ) : null}
              {/* DEV-500 (BRD 5.4): the contract type from its proposal. */}
              {contractTypeLabel(contract.customer?.contractType) ? <Badge variant="outline">{contractTypeLabel(contract.customer?.contractType)}</Badge> : null}
            </div>
            <div className="flex flex-row flex-wrap items-center gap-2">
              <h2 className="text-2xl">{contract.customerName || "Unnamed client"}</h2>
              <Badge variant="secondary" className={`border-0 font-medium ${contractStatusTone(contract.displayStatus)}`}>
                {CONTRACT_STATUS_LABELS[contract.displayStatus]}
              </Badge>
              {/* Ending on a set day (24 Nov 2026). */}
              {data.ending ? (
                <Badge variant="secondary" className="bg-danger/10 text-danger border-0 font-medium">
                  Ending {formatContractDate(data.ending.effectiveOn)}
                </Badge>
              ) : null}
              <CopyId id={contract.id} />
            </div>
            <p className="text-muted-foreground text-sm">
              {/* Short and to the point (11 Nov 2026): where, the term, who looks after it. */}
              {[
                shortPlace(contract.propertyLabel),
                `${shortDay(contract.startDate)} – ${shortDay(contract.endDate)}`,
                contract.accountManagers[0]?.name
                  ? `${contract.accountManagers[0].name}${contract.accountManagers.length > 1 ? ` +${contract.accountManagers.length - 1}` : ""}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/*
              The actions in view (18 Nov 2026): each step its own button, the
              two client report actions in one dropdown, and the ways to end
              the contract in another. Check coverage left the header.
            */}
            {stepButtons.map((b) => (
              <Button key={b.key} variant="outline" onClick={b.onClick}>
                {b.icon}
                {b.label}
              </Button>
            ))}
            <Button asChild variant="outline">
              <Link href={`/extensions/amc/${contract.submissionId}`}>
                <FileSignature className="size-4" />
                Source proposal
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <FileText className="size-4" />
                  Client report
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setViewingReport(true)}>
                  <FileText className="size-4" />
                  View report
                </DropdownMenuItem>
                {canOperate ? (
                  <DropdownMenuItem onClick={() => setReporting(true)}>
                    <Send className="size-4" />
                    Send to the client
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {endItems.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="text-danger hover:text-danger">
                    <Power className="size-4" />
                    End contract
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {endItems}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {primary ? (
              <Button onClick={primary.onClick}>
                {primary.icon}
                {primary.label}
              </Button>
            ) : null}
          </div>
        </div>

        {attention ? (
          <div
            className={`border-t px-5 py-3 ${attention.tone === "danger"
              ? "border-danger/30 bg-danger/5"
              : attention.tone === "warning"
                ? "border-warning/30 bg-warning/5"
                : "border-brand/30 bg-brand-50"
              }`}
          >
            <p
              className={`text-sm font-medium ${attention.tone === "danger" ? "text-danger" : attention.tone === "warning" ? "text-warning" : "text-brand"
                }`}
            >
              {attention.title}
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">{attention.body}</p>
          </div>
        ) : null}
      </Card>

      <StatCardGrid columns={4}>
        {data.ending ? (
          /* Ending early (24 Nov 2026): the real last day, and what it was to run to. */
          <StatCard
            label="Term"
            value={<span className="text-xl">{endsInLabel(data.ending.effectiveOn)}</span>}
            headline={`${formatContractDate(contract.startDate)} to ${formatContractDate(data.ending.effectiveOn)}`}
            caption={`Early termination; was to run to ${formatContractDate(contract.endDate)}`}
            tone="bad"
          />
        ) : (
          <StatCard
            label="Term"
            value={<span className="text-xl">{data.expiryLabel}</span>}
            headline={`${formatContractDate(contract.startDate)} to ${formatContractDate(contract.endDate)}`}
            caption={contract.termMonths ? `${contract.termMonths} months` : "Contract period"}
            tone={contract.displayStatus === "expiring" ? "progress" : contract.displayStatus === "expired" ? "bad" : "neutral"}
          />
        )}
        <StatCard
          label="Contract value"
          value={<Money value={contract.grandTotal} className="text-xl" />}
          headline={`incl. ${AMC_VAT_PERCENT}% VAT`}
          caption={`${contract.finalPrice.toLocaleString("en-AE", { minimumFractionDigits: 2 })} AED before VAT`}
        />
        <StatCard
          label="Coverage"
          value={<span className="text-xl tabular-nums">{summary.totalServices} {summary.totalServices === 1 ? "service" : "services"}</span>}
          headline={
            counted
              ? `${summary.withRemaining} with allowance left${summary.exhausted ? ` · ${summary.exhausted} exhausted` : ""}`
              : "No counted allowances"
          }
          caption={[
            summary.unlimited ? `${summary.unlimited} unlimited` : null,
            summary.informational ? `${summary.informational} included` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Visits and hours are counted"}
          tone={summary.exhausted ? "progress" : "neutral"}
          onSelect={() => setTab("coverage")}
          selectLabel="Open the coverage tab"
        />
        <StatCard
          label="Usage"
          value={<span className="text-xl tabular-nums">{summary.usageEvents} {summary.usageEvents === 1 ? "entry" : "entries"}</span>}
          headline={
            [
              summary.includedVisits ? `${formatQuantity(summary.remainingVisits)} of ${formatQuantity(summary.includedVisits)} visits left` : null,
              summary.includedHours ? `${formatQuantity(summary.remainingHours)} of ${formatQuantity(summary.includedHours)} hours left` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "No visit or hour allowances"
          }
          caption={summary.lastUsageDate ? `Last used ${formatContractDate(summary.lastUsageDate.slice(0, 10))}` : "Nothing used yet"}
          onSelect={() => setTab(HIDDEN_TABS.has("usage") ? "coverage" : "usage")}
          selectLabel={HIDDEN_TABS.has("usage") ? "Open the coverage tab" : "Open the usage tab"}
        />
      </StatCardGrid>

      {/* An amendment waiting for a decision or to be applied, above the tabs (24 Nov 2026). */}
      <PendingAmendmentsNotice contractId={contract.id} tab={tab} onOpen={() => setTab("amendments")} />
      {/* DEV-504: a signed contract whose client is not an FSM customer yet. */}
      <FsmClientNotice contractId={contract.id} status={status} canManage={canOperate} />

      <Tabs value={tab} onValueChange={setTab}>
        {/* Wraps onto a second line on a narrow screen rather than
            hiding tabs behind a sideways scroll. */}
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="coverage">
            Coverage
            <TabCount value={entitlements.length} />
          </TabsTrigger>
          <TabsTrigger value="schedule">
            Schedule
            {overdueVisits > 0 ? (
              <Badge className="bg-warning text-on-tone ml-1.5 px-1.5 font-normal tabular-nums" aria-label={`${overdueVisits} overdue`}>
                {overdueVisits}
              </Badge>
            ) : (
              <TabCount value={schedule.data?.progress.remaining} />
            )}
          </TabsTrigger>
          <TabsTrigger value="call-outs">Call outs &amp; work</TabsTrigger>
          {!HIDDEN_TABS.has("usage") ? (
            <TabsTrigger value="usage">
              Usage
              <TabCount value={summary.usageEvents} />
            </TabsTrigger>
          ) : null}
          {!HIDDEN_TABS.has("fsm") ? <TabsTrigger value="fsm">FSM</TabsTrigger> : null}
          {canViewPayments ? (
            <TabsTrigger value="payments">
              Payments
              <TabCount value={openInstalmentCount(payments.data)} />
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="renewal">Renewal</TabsTrigger>
          <TabsTrigger value="amendments">Amendments</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="history">
            History
            <TabCount value={historyEntries.length} />
          </TabsTrigger>
        </TabsList>

        {panel(
          "overview",
          <>
            {/* Phase 6: from the client's approval to activation and after. */}
            <ContractLifecycleCard data={data} />
            <ContractCustomer
              contract={contract}
              facts={
                <>
                  <Fact label="Proposal">
                    <Link href={`/extensions/amc/${contract.submissionId}`} className="hover:text-brand underline underline-offset-2">
                      {source?.proposal_number ?? contract.proposalNumber}
                    </Link>
                  </Fact>
                  <Fact label="Signed by">{contract.signedByName}</Fact>
                  <Fact label="Signed">{formatDateTime(contract.signedAt)}</Fact>
                  {/* The record is stamped when it is created; it is only activated once it starts. */}
                  <Fact label="Activated">
                    {["draft", "pending_client_signature", "pending_internal_signature", "signed"].includes(status) ? null : formatDateTime(contract.activatedAt)}
                  </Fact>
                </>
              }
            />
            {/* The Commercial and Commercial history cards were removed (11 Nov 2026, the user): the value incl. VAT is on the Contract value card above. */}
          </>,
        )}

        {panel(
          "coverage",
          <>
            <SectionCard
              title="Coverage and allowances"
              description="Every service on the contract as signed: what it includes, how much is used, booked by open call outs, and what is left."
              icon={<ListChecks />}
              bodyClassName="border-t"
            >
              {/* As every list in the product (11 Nov 2026): the data table. Usage is recorded from the visits, so no Record button per row. */}
              <DataTable
                columns={coverageColumns({ bookedFor, nearZeroFor })}
                data={entitlements}
                loading={false}
                rowCount={entitlements.length}
                pageSize={500}
                currentPage={0}
                onPageChange={noop}
                onPageSizeChange={noop}
                onGlobalFilterChange={noop}
                emptyState={<EmptyState icon={<ListChecks />} title="No services" description="The services signed on the contract, with what each includes, show here." />}
              />
            </SectionCard>

            {/* Hidden for now (10 Nov 2026, Danish): set SHOW_ENTITLEMENT_TERMS to bring the card back. */}
            {SHOW_ENTITLEMENT_TERMS ? <EntitlementTermsCard data={data} onChanged={() => void load()} /> : null}

            <SectionCard title="Service levels" icon={<Gauge />} bodyClassName="px-5 pb-5 space-y-3">
              {commitments?.fromSnapshot ? (
                <>
                  {/* As the client signed them: from this contract's frozen wording. */}
                  <div>
                    {/* <SubHeading>As signed</SubHeading> */}
                    <DetailList
                      rows={[
                        ...(commitments.emergencyResponse
                          ? [{ label: "Emergency response", value: <Promised value={commitments.emergencyResponse} note="Not measured" /> }]
                          : []),
                        ...(commitments.standardResponse
                          ? [{ label: "Standard response", value: <Promised value={commitments.standardResponse} note="Not measured" /> }]
                          : []),
                        { label: "24/7 technical support line", value: commitments.helpdeskIncluded ? "Included" : "Not included" },
                        ...(commitments.supportContact ? [{ label: "Support contact", value: commitments.supportContact }] : []),
                      ]}
                    />
                  </div>
                  {/* <p className="text-muted-foreground text-xs">
                    Read from the wording frozen with this contract, so later settings changes do not alter it.
                  </p> */}
                </>
              ) : null}
              {commitments?.fromSnapshot ? null : sla.length === 0 ? (
                <></>
                // <p className="text-muted-foreground text-sm">No call-out services on this contract, so no response targets.</p>
              ) : (
                <div>
                  <SubHeading>Response targets</SubHeading>
                  <DetailList
                    rows={sla.map((s) => ({
                      key: s.callOutClass,
                      label: s.label,
                      value: <Promised value={`${s.targetMinutes} minutes from the request`} note="Status unknown" />,
                    }))}
                  />
                </div>
              )}
              {/* <p className="text-muted-foreground text-xs">
                Whether a call-out met its target needs the request and arrival times from FSM, which the
                portal does not receive yet.
              </p> */}
            </SectionCard>
            {/* DEV-499: the allowance used, by date (visits, call outs, corrections), under the balances while the Usage tab is hidden.
                Correcting an entry needs the correction right and a reason. */}
            {HIDDEN_TABS.has("usage") ? (
              <UsageHistory contractId={contract.id} entitlements={entitlements} canCorrect={permissions.canCorrect} refreshKey={usageVersion} onChanged={reloadAll} />
            ) : null}
          </>,
        )}

        {panel("schedule", <ContractSchedulePanel contractId={contract.id} schedule={schedule} />)}

        {panel("call-outs", <ContractCallOutsPanel contractId={contract.id} contractOpen={status === "active" || status === "on_hold"} />)}

        {panel(
          "usage",
          <UsageHistory
            contractId={contract.id}
            entitlements={entitlements}
            canCorrect={permissions.canCorrect}
            refreshKey={usageVersion}
            onChanged={reloadAll}
          />,
        )}

        {panel(
          "fsm",
          <ContractFsm
            contractId={contract.id}
            entitlements={entitlements}
            canManage={permissions.canCorrect}
            onUsageChanged={reloadAll}
          />,
        )}

        {canViewPayments
          ? panel(
            "payments",
            <ContractPaymentsPanel
              contractId={contract.id}
              contractStatus={status}
              payments={payments}
              dialogs={paymentDialogs}
              onChanged={reloadWithPayments}
            />,
          )
          : null}

        {panel(
          "renewal",
          <ContractRenewal
            contractId={contract.id}
            proposalNumber={contract.lifecycle?.contractNumber ?? contract.proposalNumber}
            canRenew={permissions.canRenew}
            onChanged={() => void load()}
            reminders={<RenewalReminders contractId={contract.id} cancelled={contract.status === "cancelled"} />}
          />,
        )}

        {panel(
          "amendments",
          <ContractAmendmentsPanel
            requestKind={requestKind}
            onRequestShown={() => setRequestKind(null)}
            contractId={contract.id}
            contractStatus={contract.status}
            contractNumber={contract.lifecycle?.contractNumber ?? contract.proposalNumber}
            propertyLabel={contract.propertyLabel}
            onChanged={() => void load()}
          />,
        )}

        {panel(
          "documents",
          <ContractDocuments
            submissionId={contract.submissionId}
            proposalSentAt={source?.proposal_sent_at ?? null}
            contractSentAt={source?.contract_sent_at ?? null}
            contractId={contract.id}
            canUpload={canOperate}
          />,
        )}

        {panel(
          "history",
          /* As a Snagging job's Activity (11 Nov 2026), as every AMC history. */
          <HistoryCard
            description="Everything done to this contract and its visit schedule."
            entries={historyEntries}
            emptyDescription="Activation, holds, renewals, amendments and every other change appear here as they happen."
          />,
        )}
      </Tabs>

      <RecordUsageDialog
        open={usageOpen}
        onOpenChange={setUsageOpen}
        contract={contract}
        entitlements={entitlements}
        initialEntitlementId={usageFor}
        onRecorded={reloadAll}
      />
      <CoverageCheckDialog
        open={checking}
        onOpenChange={setChecking}
        /* Named by the contract number the team and the client know it by. */
        contract={{
          id: contract.id,
          proposalNumber: contract.lifecycle?.contractNumber ?? contract.proposalNumber,
          customerName: contract.customerName,
          serviceIds: entitlements.map((e) => e.serviceId),
          active: contract.status === "active",
          statusLabel: CONTRACT_STATUS_LABELS[contract.displayStatus as keyof typeof CONTRACT_STATUS_LABELS] ?? contract.status,
        }}
      />
      <SendClientReportDialog
        open={reporting}
        onOpenChange={setReporting}
        contractId={contract.id}
        contractLabel={`AMC ${contract.lifecycle?.contractNumber ?? contract.proposalNumber}`}
        customerName={contract.customerName}
        defaultEmail={(contract.customer as Record<string, string | undefined>).customerEmail?.trim() || null}
        onPreview={() => {
          setReporting(false);
          setViewingReport(true);
        }}
      />
      <ClientReportViewer
        open={viewingReport}
        onOpenChange={setViewingReport}
        contractId={contract.id}
        title={`${contract.customerName || "Client"} · service report ${contract.lifecycle?.contractNumber ?? contract.proposalNumber}`}
        onSend={
          canOperate
            ? () => {
              setViewingReport(false);
              setReporting(true);
            }
            : undefined
        }
      />
      {lifecycleDialogs.dialogs}
      {paymentDialogs.dialogs}
    </div>
  );
}

/** A contract before it arrives: toolbar, header card, the four figures, then the tabs. */
export function ContractDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
      </Card>
      <StatGridSkeleton count={4} />
      <div className="bg-muted flex w-full items-center gap-1 rounded-lg p-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="bg-background/60 h-7 flex-1 rounded-md" />
        ))}
      </div>
      <SectionSkeleton />
    </div>
  );
}

/** One back link, so every state on this screen keeps a way out. */
function BackToContracts() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
      <Link href={LIST}>
        <ArrowLeft className="size-4" />
        Contracts
      </Link>
    </Button>
  );
}

/** "14:32" on the viewer's own clock, for the "Updated" note beside Refresh. */
function formatClock(at: number): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}

/** The contract's id behind a copy button: support needs it, nobody reads it. */
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy the contract ID");
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={() => void copy()} aria-label={`Copy contract ID ${id}`}>
          {copied ? <Check className="text-success size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-mono text-xs">{id}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{copied ? "Copied" : "Click to copy the contract ID"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Label-and-value rows, as on a Snagging job's setup: an em dash when empty. */
function DetailList({ rows }: { rows: Array<{ key?: string; label: string; value?: ReactNode }> }) {
  return (
    <dl className="divide-y">
      {rows.map((row) => (
        <div key={row.key ?? row.label} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-muted-foreground shrink-0 text-sm">{row.label}</dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium">
            {row.value || row.value === 0 ? <TruncateIfText>{row.value}</TruncateIfText> : <span className="text-muted-foreground font-normal">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A promised figure, and a badge saying the portal cannot yet tell whether it is met. */
function Promised({ value, note }: { value: string; note: string }) {
  return (
    <span className="flex min-w-0 items-center justify-end gap-2">
      <TruncatedText text={value} />
      <NotMeasured label={note} />
    </span>
  );
}

function NotMeasured({ label }: { label: string }) {
  return (
    <Badge variant="secondary" className="bg-mist text-ink-soft border-0 font-medium">
      {label}
    </Badge>
  );
}
