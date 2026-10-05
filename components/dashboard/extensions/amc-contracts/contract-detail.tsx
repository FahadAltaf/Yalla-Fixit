"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Ban,
  FileSignature,
  Gauge,
  History,
  ListChecks,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DataRow,
  PageHeading,
  SectionCard,
  StatCard,
  StatCardGrid,
  SubHeading,
} from "@/components/dashboard/shared/kaizen";
import {
  ErrorState,
  HeadingSkeleton,
  SectionSkeleton,
  StatGridSkeleton,
} from "@/components/dashboard/shared/kaizen-states";
import { formatQuantity, unitWord } from "@/lib/amc/contracts";
import { AMC_VAT_PERCENT } from "@/lib/amc/pricing";
import { amcContractsService, type ContractDetail as Detail } from "@/modules/amc-contracts/amc-contracts-service";

import { CancelContractDialog } from "./cancel-contract-dialog";
import { ContractDocuments } from "./contract-documents";
import { ContractRenewal, RenewalReminders } from "./contract-renewal";
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
import { RecordUsageDialog } from "./record-usage-dialog";
import { UsageHistory } from "./usage-history";

/**
 * One operational AMC contract: its state and what is left, every service
 * and its allowance, recording and correcting usage, coverage checks,
 * renewal, documents, service levels and the history.
 */
export function ContractDetail({ id }: { id: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [usageFor, setUsageFor] = useState<string | null | undefined>(undefined);
  const [cancelling, setCancelling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [usageVersion, setUsageVersion] = useState(0);

  useBreadcrumbLabel(id, data?.contract.proposalNumber ?? "Contract");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await amcContractsService.get(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the contract.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /* After usage or a correction: the allowances and the history both move. */
  const reloadAll = () => {
    setUsageVersion((v) => v + 1);
    void load();
  };

  if (loading && !data) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <HeadingSkeleton withActions />
        <StatGridSkeleton />
        <SectionSkeleton />
        <SectionSkeleton />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex w-full flex-1 flex-col gap-6">
        <ErrorState
          title="Could not load this contract"
          message={error}
          onRetry={() => void load()}
          retrying={loading}
        />
      </div>
    );
  }

  const { contract, entitlements, summary, audit, source, permissions, sla } = data;
  const customer = contract.customer as Record<string, string | undefined>;
  const canRecord = permissions.canRecordUsage && entitlements.some((e) => e.consumable);
  const counted = summary.withRemaining + summary.exhausted;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow={`AMC contract · ${contract.proposalNumber}`}
        title={contract.customerName || "Unnamed customer"}
        description={contract.propertyLabel || undefined}
        actions={
          /* Four actions: they wrap on a phone rather than run off the screen. */
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
            <Button variant="outline" onClick={() => setChecking(true)}>
              <ShieldCheck className="size-4" />
              Check coverage
            </Button>
            {permissions.canCancel ? (
              <Button variant="outline" onClick={() => setCancelling(true)}>
                <Ban className="size-4" />
                Cancel contract
              </Button>
            ) : null}
            {canRecord ? (
              <Button onClick={() => setUsageFor(null)}>
                <Plus className="size-4" />
                Record usage
              </Button>
            ) : null}
          </div>
        }
      />

      {contract.status === "cancelled" ? (
        <div className="bg-destructive/5 text-destructive rounded-lg border border-destructive/20 px-4 py-3 text-sm">
          Cancelled {formatDateTime(contract.cancelledAt)}
          {contract.cancellationReason ? `: ${contract.cancellationReason}` : "."} Coverage has stopped and no
          new usage can be recorded. Usage already recorded stays below.
        </div>
      ) : contract.displayStatus === "not_started" ? (
        <div className="rounded-lg border border-sky-600/20 bg-sky-600/5 px-4 py-3 text-sm text-sky-800 dark:text-sky-300">
          Coverage starts on {formatContractDate(contract.startDate)}. Usage can be recorded from then.
        </div>
      ) : contract.displayStatus === "expired" ? (
        <div className="bg-destructive/5 text-destructive rounded-lg border border-destructive/20 px-4 py-3 text-sm">
          This contract ended on {formatContractDate(contract.endDate)}. Work after that date is chargeable
          unless the contract is renewed.
        </div>
      ) : null}

      <StatCardGrid columns={4}>
        <StatCard
          label="Status"
          value={
            <Badge variant="secondary" className={`border-none text-base ${contractStatusTone(contract.displayStatus)}`}>
              {CONTRACT_STATUS_LABELS[contract.displayStatus]}
            </Badge>
          }
          headline={data.expiryLabel}
          caption={`${formatContractDate(contract.startDate)} to ${formatContractDate(contract.endDate)}${contract.termMonths ? ` · ${contract.termMonths} months` : ""}`}
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
        />
      </StatCardGrid>

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
                      <Badge variant="secondary" className={`border-none font-normal ${entitlementStateTone(e.state)}`}>
                        {ENTITLEMENT_STATE_LABELS[e.state]}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      {permissions.canRecordUsage && e.consumable ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setUsageFor(e.id)}
                          disabled={e.state === "exhausted"}
                        >
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

      <UsageHistory
        contractId={contract.id}
        entitlements={entitlements}
        canCorrect={permissions.canCorrect}
        refreshKey={usageVersion}
        onChanged={reloadAll}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Customer and property" icon={<UserRound />} bodyClassName="px-5 pb-5 space-y-3">
          <DataRow title={contract.customerName || "—"} subtitle={contract.customerRef ? `Customer ID ${contract.customerRef}` : "Customer"} />
          {customer.customerPhone || customer.customerEmail ? (
            <DataRow title={customer.customerPhone || "—"} subtitle={customer.customerEmail || "Contact"} />
          ) : null}
          <DataRow title={contract.propertyLabel || "—"} subtitle="Property" />
          <SubHeading>Account managers</SubHeading>
          {contract.accountManagers.length ? (
            contract.accountManagers.map((m, i) => (
              <DataRow key={`${m.name}-${i}`} title={m.name || "—"} subtitle={m.phone || undefined} />
            ))
          ) : (
            <p className="text-muted-foreground text-sm">None named on the signed proposal.</p>
          )}
          <p className="text-muted-foreground text-xs">As named on the signed proposal.</p>
        </SectionCard>

        <SectionCard title="Commercial" icon={<ReceiptText />} bodyClassName="px-5 pb-5">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd><Money value={contract.subtotal} /></dd>
            </div>
            {contract.discountAmount > 0 ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Discount ({contract.discountPercent}%)</dt>
                <dd>−<Money value={contract.discountAmount} /></dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Fee before VAT</dt>
              <dd><Money value={contract.finalPrice} /></dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">VAT ({AMC_VAT_PERCENT}%)</dt>
              <dd><Money value={contract.vatAmount} /></dd>
            </div>
            <div className="flex justify-between gap-3 border-t pt-2 font-medium">
              <dt>Grand total</dt>
              <dd><Money value={contract.grandTotal} /></dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard title="Service levels" icon={<Gauge />} bodyClassName="px-5 pb-5 space-y-3">
          {sla.length === 0 ? (
            <p className="text-muted-foreground text-sm">No call-out services on this contract, so no response targets.</p>
          ) : (
            sla.map((s) => (
              <DataRow
                key={s.callOutClass}
                title={s.label}
                subtitle={`Target ${s.targetMinutes} minutes from the request`}
                trailing={
                  <Badge variant="secondary" className="font-normal">
                    Status unknown
                  </Badge>
                }
              />
            ))
          )}
          <p className="text-muted-foreground text-xs">
            Whether a call-out met its target needs the request and arrival times from FSM, which the
            portal does not receive yet.
          </p>
        </SectionCard>

        <ContractRenewal
          contractId={contract.id}
          proposalNumber={contract.proposalNumber}
          canRenew={permissions.canRenew}
          onChanged={() => void load()}
        />

        <RenewalReminders contractId={contract.id} cancelled={contract.status === "cancelled"} />

        <ContractDocuments
          submissionId={contract.submissionId}
          proposalSentAt={source?.proposal_sent_at ?? null}
          contractSentAt={source?.contract_sent_at ?? null}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Source" icon={<FileSignature />} bodyClassName="px-5 pb-5 space-y-3">
          <DataRow
            title={
              <Link href={`/extensions/amc/${contract.submissionId}`} className="hover:underline">
                Proposal {source?.proposal_number ?? contract.proposalNumber}
              </Link>
            }
            subtitle={`Signed by ${contract.signedByName} · ${formatDateTime(contract.signedAt)}`}
          />
          <DataRow title="Activated" subtitle={formatDateTime(contract.activatedAt)} />
        </SectionCard>

        <SectionCard title="History" icon={<History />} className="lg:col-span-2" bodyClassName="px-5 pb-5">
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
        </SectionCard>
      </div>

      {usageFor !== undefined ? (
        <RecordUsageDialog
          open={usageFor !== undefined}
          onOpenChange={(next) => !next && setUsageFor(undefined)}
          contract={contract}
          entitlements={entitlements}
          initialEntitlementId={usageFor}
          onRecorded={() => {
            setUsageFor(undefined);
            reloadAll();
          }}
        />
      ) : null}
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
    </div>
  );
}
