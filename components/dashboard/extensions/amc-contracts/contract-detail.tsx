"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  CalendarRange,
  ClipboardList,
  FileSignature,
  History,
  ListChecks,
  Plus,
  ReceiptText,
  RefreshCw,
  Repeat,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbLabel } from "@/components/dashboard-layout/breadcrumb-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
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
import {
  CONTRACT_STATUS_LABELS,
  ENTITLEMENT_TYPE_LABELS,
  contractStatusTone,
  daysRemainingLabel,
  formatContractDate,
  formatDateTime,
} from "./contract-status";
import { RecordUsageDialog } from "./record-usage-dialog";

const AUDIT_LABELS: Record<string, string> = {
  contract_activated: "Contract activated",
  contract_cancelled: "Contract cancelled",
  entitlement_consumed: "Usage recorded",
  entitlement_adjusted: "Usage adjusted",
  renewal_created: "Renewal proposal started",
};

/**
 * One operational AMC contract: who and where, the period and value, what
 * each contracted service includes and how much is used, the signed
 * commercial values, where it came from, and its history.
 */
export function ContractDetail({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [usageFor, setUsageFor] = useState<string | null | undefined>(undefined);
  const [cancelling, setCancelling] = useState(false);
  const [renewing, setRenewing] = useState(false);

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

  const startRenewal = async () => {
    setRenewing(true);
    try {
      const result = await amcContractsService.startRenewal(id);
      if (result.droppedServiceIds.length) {
        toast.warning(
          `Renewal started. Not carried over (no longer offered): ${result.droppedServiceIds.join(", ")}.`,
        );
      } else {
        toast.success("Renewal proposal started as a draft");
      }
      router.push(`/extensions/amc/${result.submissionId}/edit`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the renewal.");
    } finally {
      setRenewing(false);
    }
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

  const { contract, entitlements, usage, audit, source, permissions } = data;
  const byEntitlement = new Map(entitlements.map((e) => [e.id, e]));
  const customer = contract.customer as Record<string, string | undefined>;
  const counted = entitlements.filter((e) => e.remainingQuantity !== null);
  const exhausted = counted.filter((e) => (e.remainingQuantity ?? 0) <= 0).length;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeading
        eyebrow={`AMC contract · ${contract.proposalNumber}`}
        title={contract.customerName || "Unnamed customer"}
        description={contract.propertyLabel || undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
            {permissions.canRenew ? (
              <Button variant="outline" onClick={() => void startRenewal()} disabled={renewing}>
                <Repeat className="size-4" />
                {renewing ? "Starting…" : "Start renewal"}
              </Button>
            ) : null}
            {permissions.canCancel ? (
              <Button variant="outline" onClick={() => setCancelling(true)}>
                <Ban className="size-4" />
                Cancel contract
              </Button>
            ) : null}
            {permissions.canRecordUsage && counted.length + entitlements.filter((e) => e.entitlementType === "unlimited").length > 0 ? (
              <Button onClick={() => setUsageFor(null)}>
                <Plus className="size-4" />
                Record usage
              </Button>
            ) : null}
          </>
        }
      />

      <StatCardGrid columns={4}>
        <StatCard
          label="Status"
          value={
            <Badge variant="secondary" className={`border-none text-base ${contractStatusTone(contract.displayStatus)}`}>
              {CONTRACT_STATUS_LABELS[contract.displayStatus]}
            </Badge>
          }
          headline={daysRemainingLabel(contract.daysRemaining)}
          caption={contract.renewedByContractId ? "Renewed by a later contract" : "Derived from the end date"}
        />
        <StatCard
          label="Contract period"
          value={<span className="text-xl tabular-nums">{formatContractDate(contract.startDate)}</span>}
          headline={`to ${formatContractDate(contract.endDate)}`}
          caption={contract.termMonths ? `${contract.termMonths} months` : undefined}
        />
        <StatCard
          label="Contract value"
          value={<Money value={contract.grandTotal} className="text-xl" />}
          headline={`incl. ${AMC_VAT_PERCENT}% VAT`}
          caption={`${contract.finalPrice.toLocaleString("en-AE", { minimumFractionDigits: 2 })} AED a year before VAT`}
        />
        <StatCard
          label="Allowances"
          value={<span className="text-xl tabular-nums">{counted.length - exhausted} of {counted.length}</span>}
          headline={exhausted ? `${exhausted} used up` : "None used up"}
          caption="Counted services with something left"
          tone={exhausted ? "progress" : "neutral"}
        />
      </StatCardGrid>

      {contract.status === "cancelled" ? (
        <div className="bg-destructive/5 text-destructive rounded-lg border border-destructive/20 px-4 py-3 text-sm">
          Cancelled {formatDateTime(contract.cancelledAt)}
          {contract.cancellationReason ? `: ${contract.cancellationReason}` : "."}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title="Coverage and usage"
          description="Every service on the contract, as signed, and how much of each is used."
          icon={<ListChecks />}
          className="lg:col-span-2"
          bodyClassName="px-5 pb-5"
        >
          <div className="divide-y">
            {entitlements.map((e) => (
              <div key={e.id} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.serviceLabel}</span>
                    <Badge variant="secondary" className="font-normal">
                      {ENTITLEMENT_TYPE_LABELS[e.entitlementType]}
                    </Badge>
                    {e.callOutClass ? (
                      <Badge variant="outline" className="font-normal">
                        {e.callOutClass === "emergency" ? "Emergency" : "Non-emergency"}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-sm">
                    {e.units} {e.units === 1 ? "unit" : "units"} ·{" "}
                    {e.entitlementType === "hours"
                      ? `${e.frequency} hours a year`
                      : e.entitlementType === "visits"
                        ? `${e.frequency} a year`
                        : e.entitlementType === "unlimited"
                          ? "unlimited"
                          : "covered"}
                  </div>
                  {e.usagePercent !== null ? (
                    <Progress value={e.usagePercent} className="mt-2 h-1.5" aria-label={`${e.serviceLabel} usage`} />
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <div className="text-right text-sm">
                    <div className="tabular-nums">{e.usageLabel}</div>
                    <div className="text-muted-foreground text-xs">
                      {e.remainingQuantity !== null
                        ? `${formatQuantity(e.remainingQuantity)} ${unitWord(e.entitlementType, e.remainingQuantity)} left`
                        : e.entitlementType === "unlimited"
                          ? "No limit"
                          : "Not counted"}
                    </div>
                  </div>
                  {permissions.canRecordUsage && e.consumable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setUsageFor(e.id)}
                      disabled={e.remainingQuantity !== null && e.remainingQuantity <= 0}
                    >
                      Record
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="flex flex-col gap-6">
          <SectionCard title="Overview" icon={<UserRound />} bodyClassName="px-5 pb-5 space-y-3">
            <DataRow title={contract.customerName || "—"} subtitle={contract.customerRef ? `Customer ID ${contract.customerRef}` : "Customer"} />
            {customer.customerPhone || customer.customerEmail ? (
              <DataRow
                title={customer.customerPhone || "—"}
                subtitle={customer.customerEmail || "Contact"}
              />
            ) : null}
            <DataRow title={contract.propertyLabel || "—"} subtitle="Property" />
            <SubHeading>Account managers</SubHeading>
            {contract.accountManagers.length ? (
              contract.accountManagers.map((m, i) => (
                <DataRow key={`${m.name}-${i}`} title={m.name || "—"} subtitle={m.phone || undefined} />
              ))
            ) : (
              <p className="text-muted-foreground text-sm">None named on the proposal.</p>
            )}
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
                <dt className="text-muted-foreground">Annual fee before VAT</dt>
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
            {contract.renewedFromContractId ? (
              <DataRow
                title={
                  <Link href={`/extensions/amc-contracts/${contract.renewedFromContractId}`} className="hover:underline">
                    Renews an earlier contract
                  </Link>
                }
              />
            ) : null}
            {contract.renewedByContractId ? (
              <DataRow
                title={
                  <Link href={`/extensions/amc-contracts/${contract.renewedByContractId}`} className="hover:underline">
                    Renewed by a later contract
                  </Link>
                }
              />
            ) : null}
          </SectionCard>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Usage history" icon={<ClipboardList />} bodyClassName="px-5 pb-5">
          {usage.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing recorded against this contract yet.</p>
          ) : (
            <div className="space-y-1">
              {usage.map((u) => {
                const e = byEntitlement.get(u.entitlementId);
                const amount = `${u.quantity > 0 && u.kind === "adjustment" ? "+" : ""}${formatQuantity(u.quantity)} ${
                  e ? unitWord(e.entitlementType, Math.abs(u.quantity)) || "call-out" : ""
                }`;
                return (
                  <DataRow
                    key={u.id}
                    icon={u.kind === "adjustment" ? <History /> : <CalendarRange />}
                    title={`${e?.serviceLabel ?? "Service"} · ${u.kind === "adjustment" ? "Adjustment" : "Used"}`}
                    subtitle={[
                      formatContractDate(u.occurredAt.slice(0, 10)),
                      u.externalReference ? `${u.externalType === "fsm_appointment" ? "Appointment" : "Work order"} ${u.externalReference}` : null,
                      u.createdBy,
                      u.notes,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    trailing={<span className="tabular-nums">{amount}</span>}
                  />
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard title="History" icon={<History />} bodyClassName="px-5 pb-5">
          {audit.length === 0 ? (
            <p className="text-muted-foreground text-sm">No events yet.</p>
          ) : (
            <div className="space-y-1">
              {audit.map((a) => (
                <DataRow
                  key={a.id}
                  title={AUDIT_LABELS[a.type] ?? a.type.replace(/_/g, " ")}
                  subtitle={[a.actor, a.note].filter(Boolean).join(" · ") || undefined}
                  trailing={<span className="text-muted-foreground text-xs">{formatDateTime(a.at)}</span>}
                />
              ))}
            </div>
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
            void load();
          }}
        />
      ) : null}
      <CancelContractDialog
        open={cancelling}
        onOpenChange={setCancelling}
        contractId={contract.id}
        proposalNumber={contract.proposalNumber}
        onCancelled={() => void load()}
      />
    </div>
  );
}
