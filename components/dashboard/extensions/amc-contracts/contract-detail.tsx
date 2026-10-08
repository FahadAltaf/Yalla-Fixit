"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  Banknote,
  Check,
  Copy,
  FileSignature,
  FileUp,
  Gauge,
  History,
  ListChecks,
  MoreHorizontal,
  Pause,
  PenLine,
  Play,
  Plus,
  Power,
  ReceiptText,
  RefreshCw,
  SearchX,
  ShieldCheck,
  XCircle,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DataRow,
  SectionCard,
  StatCard,
  StatCardGrid,
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

import { CancelContractDialog } from "./cancel-contract-dialog";
import { ContractCommercial } from "./contract-commercial";
import { ContractCustomer } from "./contract-customer";
import { ContractDocuments } from "./contract-documents";
import { ContractFsm } from "./contract-fsm";
import { ContractLifecycleCard, EntitlementTermsCard, useLifecycleDialogs } from "./contract-lifecycle-panel";
import { ContractPaymentsPanel, openInstalmentCount, useContractPayments } from "./contract-payments-panel";
import { ContractRenewal, RenewalReminders } from "./contract-renewal";
import { ContractSchedulePanel, useContractSchedule } from "./contract-schedule-panel";
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
import { CoverageCheckDialog } from "./coverage-check-dialog";
import { usePaymentDialogs } from "./payment-dialogs";
import { useUrlTab } from "./profile/use-url-tab";
import { RecordUsageDialog } from "./record-usage-dialog";
import { UsageHistory } from "./usage-history";

const LIST = "/extensions/amc-contracts";

const TABS = ["overview", "coverage", "schedule", "usage", "fsm", "commercial", "payments", "renewal", "documents", "history"] as const;
type Tab = (typeof TABS)[number];

/**
 * One operational AMC contract, laid out like a Snagging job: the way back
 * and Refresh, a header card with the contract's state and its next step,
 * the four figures, then tabs for its lifecycle, every service and its
 * allowance, the PPM schedule, usage, FSM, commercial, payments, renewal,
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
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} aria-label="Refresh this contract">
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
  const [cancelling, setCancelling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [usageVersion, setUsageVersion] = useState(0);
  /* Payments (Phase 7) for Finance and the owner; the tab is not offered to anyone else. */
  const canViewPayments = data.permissions.payments?.canView === true;
  const { tab, setTab, isOpened } = useUrlTab<Tab>(canViewPayments ? TABS : TABS.filter((t) => t !== "payments"), "overview");
  const payments = useContractPayments(data.contract.id, canViewPayments);
  /* The PPM schedule (Phase 8), loaded here so the tab can show what is left or overdue. */
  const schedule = useContractSchedule(data.contract.id);
  const overdueVisits = schedule.data?.progress.overdue ?? 0;
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
  const status = contract.status as ContractStatus;
  const canRecord = permissions.canRecordUsage && entitlements.some((e) => e.consumable);
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
        : canRecord
          ? { label: "Record usage", icon: <Plus className="size-4" />, onClick: () => recordUsage(null) }
          : null;
  const recordInMore = canRecord && primary?.label !== "Record usage";
  const holdItems = [
    permissions.canRecordScan ? (
      <DropdownMenuItem key="scan" onClick={() => lifecycleDialogs.open("scan")}>
        <FileUp className="size-4" />
        Record signed scan
      </DropdownMenuItem>
    ) : null,
    permissions.canHold && status === "active" ? (
      <DropdownMenuItem key="hold" onClick={() => lifecycleDialogs.openStatus("on_hold")}>
        <Pause className="size-4" />
        Put on hold
      </DropdownMenuItem>
    ) : null,
    awaitingFirst && paymentPerms?.canApprove ? (
      <DropdownMenuItem key="start" onClick={() => paymentDialogs.open(contract.id, { kind: "override_gate" })}>
        <Play className="size-4" />
        Start before payment
      </DropdownMenuItem>
    ) : null,
    permissions.canHold && status === "on_hold" ? (
      <DropdownMenuItem key="resume" onClick={() => lifecycleDialogs.openStatus("active")}>
        <Play className="size-4" />
        Resume
      </DropdownMenuItem>
    ) : null,
  ].filter(Boolean);
  const endItems = [
    permissions.canTerminate ? (
      <DropdownMenuItem key="terminate" variant="destructive" onClick={() => lifecycleDialogs.openStatus("terminated")}>
        <Power className="size-4" />
        Terminate
      </DropdownMenuItem>
    ) : null,
    permissions.canCallOff ? (
      <DropdownMenuItem key="calloff" variant="destructive" onClick={() => lifecycleDialogs.openStatus("cancelled")}>
        <XCircle className="size-4" />
        Call off
      </DropdownMenuItem>
    ) : null,
    permissions.canCancel ? (
      <DropdownMenuItem key="cancel" variant="destructive" onClick={() => setCancelling(true)}>
        <Ban className="size-4" />
        Cancel contract
      </DropdownMenuItem>
    ) : null,
  ].filter(Boolean);

  /* The one thing about this contract worth reading before anything else. */
  const attention: { tone: "danger" | "warning" | "info"; title: string; body: string } | null =
    contract.status === "cancelled"
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
            </div>
            <div className="flex flex-row flex-wrap items-center gap-2">
              <h2 className="text-2xl">{contract.customerName || "Unnamed client"}</h2>
              <Badge variant="secondary" className={`border-0 font-medium ${contractStatusTone(contract.displayStatus)}`}>
                {CONTRACT_STATUS_LABELS[contract.displayStatus]}
              </Badge>
              <CopyId id={contract.id} />
            </div>
            <p className="text-muted-foreground text-sm">
              {[
                contract.propertyLabel,
                `${formatContractDate(contract.startDate)} to ${formatContractDate(contract.endDate)}`,
                contract.accountManagers.length
                  ? `managed by ${contract.accountManagers.map((m) => m.name).filter(Boolean).join(", ")}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setChecking(true)}>
              <ShieldCheck className="size-4" />
              Check coverage
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {recordInMore ? (
                  <DropdownMenuItem onClick={() => recordUsage(null)}>
                    <Plus className="size-4" />
                    Record usage
                  </DropdownMenuItem>
                ) : null}
                {holdItems}
                <DropdownMenuItem asChild>
                  <Link href={`/extensions/amc/${contract.submissionId}`}>
                    <FileSignature className="size-4" />
                    Open source proposal
                  </Link>
                </DropdownMenuItem>
                {endItems.length ? <DropdownMenuSeparator /> : null}
                {endItems}
              </DropdownMenuContent>
            </DropdownMenu>
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
            className={`border-t px-5 py-3 ${
              attention.tone === "danger"
                ? "border-danger/30 bg-danger/5"
                : attention.tone === "warning"
                  ? "border-warning/30 bg-warning/5"
                  : "border-brand/30 bg-brand-50"
            }`}
          >
            <p
              className={`text-sm font-medium ${
                attention.tone === "danger" ? "text-danger" : attention.tone === "warning" ? "text-warning" : "text-brand"
              }`}
            >
              {attention.title}
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">{attention.body}</p>
          </div>
        ) : null}
      </Card>

      <StatCardGrid columns={4}>
        <StatCard
          label="Term"
          value={<span className="text-xl">{data.expiryLabel}</span>}
          headline={`${formatContractDate(contract.startDate)} to ${formatContractDate(contract.endDate)}`}
          caption={contract.termMonths ? `${contract.termMonths} months` : "Contract period"}
          tone={contract.displayStatus === "expiring" ? "progress" : contract.displayStatus === "expired" ? "bad" : "neutral"}
        />
        <StatCard
          label="Contract value"
          value={<Money value={contract.grandTotal} className="text-xl" />}
          headline={`incl. ${AMC_VAT_PERCENT}% VAT`}
          caption={`${contract.finalPrice.toLocaleString("en-AE", { minimumFractionDigits: 2 })} AED before VAT`}
        />
        <StatCard
          label="Coverage"
          value={<span className="text-xl tabular-nums">{summary.totalServices} services</span>}
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
          value={<span className="text-xl tabular-nums">{summary.usageEvents} entries</span>}
          headline={
            [
              summary.includedVisits ? `${formatQuantity(summary.remainingVisits)} of ${formatQuantity(summary.includedVisits)} visits left` : null,
              summary.includedHours ? `${formatQuantity(summary.remainingHours)} of ${formatQuantity(summary.includedHours)} hours left` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "No visit or hour allowances"
          }
          caption={summary.lastUsageDate ? `Last used ${formatContractDate(summary.lastUsageDate.slice(0, 10))}` : "Nothing used yet"}
          onSelect={() => setTab("usage")}
          selectLabel="Open the usage tab"
        />
      </StatCardGrid>

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
          <TabsTrigger value="usage">
            Usage
            <TabCount value={summary.usageEvents} />
          </TabsTrigger>
          <TabsTrigger value="fsm">FSM</TabsTrigger>
          <TabsTrigger value="commercial">Commercial</TabsTrigger>
          {canViewPayments ? (
            <TabsTrigger value="payments">
              Payments
              <TabCount value={openInstalmentCount(payments.data)} />
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="renewal">Renewal</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="history">
            History
            <TabCount value={audit.length} />
          </TabsTrigger>
        </TabsList>

        {panel(
          "overview",
          <>
            {/* Phase 6: from the client's approval to activation and after. */}
            <ContractLifecycleCard data={data} />
            <div className="grid gap-6 lg:grid-cols-2">
              <ContractCustomer contract={contract} canManage={permissions.canCorrect} />
              <SectionCard title="Source" icon={<FileSignature />} bodyClassName="px-5 pb-5">
                <DetailList
                  rows={[
                    {
                      label: "Proposal",
                      value: (
                        <Link href={`/extensions/amc/${contract.submissionId}`} className="hover:text-brand underline underline-offset-2">
                          {source?.proposal_number ?? contract.proposalNumber}
                        </Link>
                      ),
                    },
                    { label: "Signed by", value: contract.signedByName },
                    { label: "Signed", value: formatDateTime(contract.signedAt) },
                    { label: "Activated", value: formatDateTime(contract.activatedAt) },
                  ]}
                />
              </SectionCard>
            </div>
          </>,
        )}

        {panel(
          "coverage",
          <>
            <SectionCard
              title="Coverage"
              description="Every service on the contract, as signed, and how much of each is used."
              icon={<ListChecks />}
              bodyClassName="pb-2"
            >
              <div className="overflow-x-auto">
                <Table className="min-w-[860px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Service</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Included</TableHead>
                      <TableHead className="text-right">Used</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Call-out class</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="pr-5 text-right">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entitlements.map((e) => {
                      const counts = e.entitlementType === "visits" || e.entitlementType === "hours";
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="pl-5 font-medium">
                            {e.serviceLabel}
                            {counts && e.usagePercent !== null ? (
                              <Progress value={e.usagePercent} className="mt-1.5 h-1 w-32" aria-label={`${e.serviceLabel} usage`} />
                            ) : null}
                          </TableCell>
                          <TableCell>{ENTITLEMENT_TYPE_LABELS[e.entitlementType]}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {e.includedQuantity !== null ? formatQuantity(e.includedQuantity) : e.entitlementType === "unlimited" ? "Unlimited" : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {e.entitlementType === "informational" ? "—" : formatQuantity(e.usedQuantity)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {e.remainingQuantity !== null
                              ? `${formatQuantity(e.remainingQuantity)} ${unitWord(e.entitlementType, e.remainingQuantity)}`
                              : e.entitlementType === "unlimited"
                                ? "Unlimited"
                                : "Not counted"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {e.units} {e.units === 1 ? "unit" : "units"} ×{" "}
                            {e.entitlementType === "hours" ? `${e.frequency} h a year` : `${e.frequency} a year`}
                          </TableCell>
                          <TableCell>{e.callOutClass ? CALL_OUT_LABELS[e.callOutClass] : "—"}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={`border-0 font-medium ${entitlementStateTone(e.state)}`}>
                              {ENTITLEMENT_STATE_LABELS[e.state]}
                            </Badge>
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            {permissions.canRecordUsage && e.consumable ? (
                              <Button size="sm" variant="outline" onClick={() => recordUsage(e.id)} disabled={e.state === "exhausted"}>
                                Record
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>

            <EntitlementTermsCard data={data} onChanged={() => void load()} />

            <SectionCard title="Service levels" icon={<Gauge />} bodyClassName="px-5 pb-5 space-y-3">
              {commitments?.fromSnapshot ? (
                <>
                  {/* As the client signed them: from this contract's frozen wording. */}
                  {commitments.emergencyResponse ? (
                    <DataRow title="Emergency response (as signed)" subtitle={commitments.emergencyResponse} trailing={<NotMeasured label="Not measured" />} />
                  ) : null}
                  {commitments.standardResponse ? (
                    <DataRow title="Standard response (as signed)" subtitle={commitments.standardResponse} trailing={<NotMeasured label="Not measured" />} />
                  ) : null}
                  <DataRow
                    title="24/7 technical support line"
                    subtitle={commitments.helpdeskIncluded ? "Included in this contract" : "Not one of this contract's services"}
                  />
                  {commitments.supportContact ? <DataRow title="Support contact (as signed)" subtitle={commitments.supportContact} /> : null}
                  <p className="text-muted-foreground text-xs">
                    Read from the wording frozen with this contract, so later settings changes do not alter it.
                  </p>
                </>
              ) : null}
              {commitments?.fromSnapshot ? null : sla.length === 0 ? (
                <p className="text-muted-foreground text-sm">No call-out services on this contract, so no response targets.</p>
              ) : (
                sla.map((s) => (
                  <DataRow
                    key={s.callOutClass}
                    title={s.label}
                    subtitle={`Target ${s.targetMinutes} minutes from the request`}
                    trailing={<NotMeasured label="Status unknown" />}
                  />
                ))
              )}
              <p className="text-muted-foreground text-xs">
                Whether a call-out met its target needs the request and arrival times from FSM, which the
                portal does not receive yet.
              </p>
            </SectionCard>
          </>,
        )}

        {panel("schedule", <ContractSchedulePanel contractId={contract.id} schedule={schedule} />)}

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

        {panel(
          "commercial",
          <div className="grid gap-6 lg:grid-cols-3">
            <SectionCard title="Commercial" icon={<ReceiptText />} bodyClassName="px-5 pb-5">
              <DetailList
                rows={[
                  { label: "Subtotal", value: <Money value={contract.subtotal} /> },
                  ...(contract.discountAmount > 0
                    ? [{ label: `Discount (${contract.discountPercent}%)`, value: <>−<Money value={contract.discountAmount} /></> }]
                    : []),
                  { label: "Fee before VAT", value: <Money value={contract.finalPrice} /> },
                  { label: `VAT (${AMC_VAT_PERCENT}%)`, value: <Money value={contract.vatAmount} /> },
                  { label: "Grand total", value: <Money value={contract.grandTotal} className="font-semibold" /> },
                ]}
              />
            </SectionCard>
            <div className="lg:col-span-2">
              <ContractCommercial contract={contract} entitlements={entitlements} canManage={permissions.canCorrect} />
            </div>
          </div>,
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
          <div className="grid gap-6 lg:grid-cols-2">
            <ContractRenewal
              contractId={contract.id}
              proposalNumber={contract.proposalNumber}
              canRenew={permissions.canRenew}
              onChanged={() => void load()}
            />
            <RenewalReminders contractId={contract.id} cancelled={contract.status === "cancelled"} />
          </div>,
        )}

        {panel(
          "documents",
          <ContractDocuments
            submissionId={contract.submissionId}
            proposalSentAt={source?.proposal_sent_at ?? null}
            contractSentAt={source?.contract_sent_at ?? null}
          />,
        )}

        {panel(
          "history",
          <SectionCard title="History" description="Everything done to this contract, newest first." icon={<History />} bodyClassName="px-5 pb-5">
            {audit.length === 0 ? (
              <p className="text-muted-foreground text-sm">No events yet.</p>
            ) : (
              <ol className="relative space-y-3 border-l pl-4">
                {audit.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="bg-brand absolute top-1.5 -left-[21px] size-2.5 rounded-full" aria-hidden />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm font-medium">{AUDIT_LABELS[a.type] ?? a.type.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground text-xs">{formatDateTime(a.at)}</span>
                    </div>
                    <div className="text-muted-foreground text-sm">
                      {[a.actor ?? "System", a.note ? `Reason: ${a.note}` : null].filter(Boolean).join(" · ")}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>,
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
      <CancelContractDialog
        open={cancelling}
        onOpenChange={setCancelling}
        contractId={contract.id}
        proposalNumber={contract.proposalNumber}
        customerName={contract.customerName}
        onCancelled={reloadAll}
      />
      <CoverageCheckDialog
        open={checking}
        onOpenChange={setChecking}
        contract={{ id: contract.id, proposalNumber: contract.proposalNumber, customerName: contract.customerName }}
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
function DetailList({ rows }: { rows: Array<{ label: string; value?: ReactNode }> }) {
  return (
    <dl className="divide-y">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-muted-foreground shrink-0 text-sm">{row.label}</dt>
          <dd className="min-w-0 truncate text-right text-sm font-medium">
            {row.value || row.value === 0 ? row.value : <span className="text-muted-foreground font-normal">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function NotMeasured({ label }: { label: string }) {
  return (
    <Badge variant="secondary" className="bg-mist text-ink-soft border-0 font-medium">
      {label}
    </Badge>
  );
}
