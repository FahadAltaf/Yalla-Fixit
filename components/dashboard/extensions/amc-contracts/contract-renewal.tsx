"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { BellPlus, BellRing, CheckCircle2, ExternalLink, Flag, Info, ListChecks, Repeat } from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { SectionCard, StatCard, StatCardGrid } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SectionSkeleton, StatGridSkeleton, SubmitButton, useConfirm } from "@/components/dashboard/shared/kaizen-states";
import {
  amcContractsService,
  type ReminderPlan,
  type RenewalOverview,
} from "@/modules/amc-contracts/amc-contracts-service";
import { renewalsService, type ContractRenewalResponse } from "@/modules/amc-contracts/renewals-service";

import { formatContractDate, formatDateTime } from "./contract-status";
import { RENEWAL_OUTCOME_LABELS } from "@/lib/amc/renewal-outcomes";

import { RecordOutcomeDialog, RenewalOutcomeBadge } from "./renewal-shared";

/**
 * Renewal: where this contract sits in its chain (the contract it renewed,
 * its renewal proposal, the contract that replaced it), and starting a
 * renewal proposal from it, previewed first. The renewal is a normal draft
 * in AMC proposals; nothing is sent and this contract is not changed.
 */
export function ContractRenewal({
  contractId,
  proposalNumber,
  canRenew,
  onChanged,
  reminders,
}: {
  contractId: string;
  proposalNumber: string;
  canRenew: boolean;
  onChanged: () => void;
  /** The reminders card, shown beside the outcome. */
  reminders?: React.ReactNode;
}) {
  const [data, setData] = useState<RenewalOverview | null>(null);
  /* Phase 13: last year beside the draft, the outcome so far, and who may record it. */
  const [extra, setExtra] = useState<Omit<ContractRenewalResponse, "renewal"> | null>(null);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcomeKey, setOutcomeKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ submissionId: string; dropped: string[] } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { renewal, ...rest } = await renewalsService.renewal(contractId);
      setData(renewal);
      setExtra(rest);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the renewal.");
    }
  }, [contractId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const result = await amcContractsService.startRenewal(contractId);
      setCreated({ submissionId: result.submissionId, dropped: result.droppedServiceIds });
      toast.success("Renewal proposal created as a draft");
      await load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the renewal proposal.");
    } finally {
      setCreating(false);
    }
  };

  const steps: Array<{ label: string; detail: React.ReactNode; done: boolean }> = data
    ? [
        ...(data.renewedFrom
          ? [{
              label: "Previous contract",
              detail: <Link className="hover:underline" href={`/extensions/amc-contracts/${data.renewedFrom.id}`}>{data.renewedFrom.proposalNumber}</Link>,
              done: true,
            }]
          : []),
        { label: "This contract", detail: proposalNumber, done: true },
        {
          label: "Renewal proposal",
          detail: data.renewalProposal ? (
            <Link className="hover:underline" href={`/extensions/amc/${data.renewalProposal.id}`}>
              {data.renewalProposal.proposalNumber || "Draft"} · {data.renewalProposal.status.replace(/_/g, " ")}
            </Link>
          ) : (
            "Not started"
          ),
          done: Boolean(data.renewalProposal),
        },
        {
          label: "Renewed contract",
          detail: data.renewedBy ? (
            <Link className="hover:underline" href={`/extensions/amc-contracts/${data.renewedBy.id}`}>
              {data.renewedBy.proposalNumber}
            </Link>
          ) : (
            "Not yet"
          ),
          done: Boolean(data.renewedBy),
        },
      ]
    : [];

  const outcome = extra?.outcome?.renewal_outcome ?? null;
  const past = extra?.pastYear ?? null;
  const proposalAction = data?.renewalProposal ? (
    <Button asChild size="sm" variant="outline">
      <Link href={`/extensions/amc/${data.renewalProposal.id}`}>
        <ExternalLink className="size-4" />
        Open renewal proposal
      </Link>
    </Button>
  ) : canRenew && data?.canCreate ? (
    <Button size="sm" onClick={() => setPreviewOpen(true)}>
      <Repeat className="size-4" />
      Create renewal proposal
    </Button>
  ) : null;
  /* The step still to come: the first not done. */
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="grid gap-6">
      {error ? (
        <ErrorState title="Could not load the renewal" message={error} onRetry={() => void load()} />
      ) : !data ? (
        <>
          <StatGridSkeleton count={4} />
          <SectionSkeleton />
        </>
      ) : (
        <>
          <StatCardGrid columns={4}>
            <StatCard
              label="Renewal proposal"
              value={data.renewalProposal ? (data.renewalProposal.proposalNumber || "Draft") : "Not started"}
              headline={data.renewalProposal ? data.renewalProposal.status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : data.canCreate ? "Ready to create" : "Not available yet"}
              caption={data.preview?.escalationPercent ? `+${data.preview.escalationPercent}% on last year's prices` : undefined}
              tone={data.renewedBy ? "good" : data.renewalProposal ? "progress" : "neutral"}
            />
            <StatCard
              label="Outcome"
              value={outcome ? (RENEWAL_OUTCOME_LABELS[outcome] ?? outcome) : "Not recorded"}
              headline={extra?.outcome?.renewal_outcome_at ? `Recorded ${formatDateTime(extra.outcome.renewal_outcome_at)}` : "Set when it renews or lapses"}
              tone={outcome === "renewed" || outcome === "renewed_revised_scope" ? "good" : outcome === "lapsed" || outcome === "not_renewed" ? "bad" : outcome === "under_negotiation" ? "progress" : "neutral"}
            />
            <StatCard
              label="Visits last year"
              value={past ? `${past.visits.done} / ${past.visits.planned}` : "—"}
              headline={past ? (past.visits.notCompleted ? `${past.visits.notCompleted} not completed` : "Done so far") : undefined}
              tone={past && past.visits.planned && past.visits.done === past.visits.planned ? "good" : "neutral"}
            />
            <StatCard
              label="Call outs last year"
              value={past ? past.callOuts.total : "—"}
              headline={past ? `${past.callOuts.emergency} emergency · ${past.callOuts.chargeable} chargeable` : undefined}
              caption={past ? `${past.additionalWork.count} additional work` : undefined}
            />
          </StatCardGrid>

          <SectionCard
            title="Renewal path"
            description="Where this contract sits in its chain: the one it renewed, its renewal proposal, and the contract that replaced it."
            icon={<Repeat />}
            action={proposalAction}
            bodyClassName="px-5 pb-5 grid gap-4"
          >
            <ol className={`grid gap-3 ${steps.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
              {steps.map((step, i) => (
                <li
                  key={step.label}
                  className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${i === current ? "border-brand/40 bg-brand-50/40" : ""}`}
                >
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                      step.done ? "border-success/30 bg-success/10 text-success" : i === current ? "border-brand/40 bg-brand-50 text-brand" : "bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    {step.done ? <CheckCircle2 className="size-4" /> : i + 1}
                  </span>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-muted-foreground text-xs">{step.label}</span>
                    <span className="truncate text-sm font-medium">{step.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
            {data.blockedReason && !data.renewalProposal ? (
              <p className="text-muted-foreground bg-muted/40 rounded-lg px-4 py-3 text-sm">{data.blockedReason}</p>
            ) : null}
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-2">
            {extra ? (
              <RenewalOutcomeBlock
                outcome={extra.outcome}
                canRecord={extra.canRecordOutcome}
                onRecord={() => {
                  setOutcomeKey((k) => k + 1);
                  setOutcomeOpen(true);
                }}
              />
            ) : null}
            {reminders}
          </div>

          {past ? <PastYearBlock pastYear={past} /> : null}
        </>
      )}

      <RecordOutcomeDialog
        key={outcomeKey}
        open={outcomeOpen}
        onOpenChange={setOutcomeOpen}
        contractId={contractId}
        contractNumber={proposalNumber}
        current={extra?.outcome?.renewal_outcome ?? null}
        onRecorded={() => void load()}
      />

      <Dialog open={previewOpen} onOpenChange={(next) => !creating && setPreviewOpen(next)}>
        <ActionDialogContent busy={creating} className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create renewal proposal</DialogTitle>
            <DialogDescription>
              A draft in AMC proposals, pre-filled from AMC {proposalNumber}. Nothing is sent, and this
              contract does not change.
            </DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="grid gap-3 py-2 text-sm">
              <p>The renewal proposal has been created as a draft.</p>
              {created.dropped.length ? (
                <p className="text-warning">
                  Not carried over (no longer offered): {created.dropped.join(", ")}.
                </p>
              ) : null}
            </div>
          ) : data?.preview ? (
            <div className="grid gap-4 py-2 text-sm">
              <dl className="grid grid-cols-2 gap-3 rounded-lg border p-3">
                <div>
                  <dt className="text-muted-foreground text-xs">New period</dt>
                  <dd className="font-medium tabular-nums">
                    {formatContractDate(data.preview.startDate)} to {formatContractDate(data.preview.endDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Discount</dt>
                  <dd className="font-medium">{data.preview.discountPercent}%</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Current contract</dt>
                  <dd className="font-medium"><Money value={data.preview.previousGrandTotal} /></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Renewal at today&apos;s settings</dt>
                  <dd className="font-medium"><Money value={data.preview.grandTotal} /></dd>
                </div>
                {data.preview.escalationPercent ? (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground text-xs">Escalation</dt>
                    <dd className="font-medium">+{data.preview.escalationPercent}% on last year&apos;s prices</dd>
                  </div>
                ) : null}
              </dl>
              <div>
                <p className="mb-1 font-medium">Copied: client, property, account managers and these services</p>
                <ul className="divide-y rounded-lg border">
                  {data.preview.services.map((s) => (
                    <li key={s.serviceId} className="flex justify-between gap-2 px-3 py-1.5">
                      <span>{s.label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {s.units} × {s.frequency}
                        {s.basePrice !== null ? ` · ${s.basePrice.toLocaleString("en-AE")} AED base` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {data.preview.droppedServices.length ? (
                <p className="text-warning">
                  Not carried over (no longer offered for this property type):{" "}
                  {data.preview.droppedServices.map((s) => s.label).join(", ")}.
                </p>
              ) : null}
              <p className="bg-muted/40 rounded-md px-3 py-2 text-xs">
                Pricing: each service keeps the base price it was contracted at, and the total is
                recalculated with today&apos;s AMC settings and VAT. Review the prices before sending; the
                renewal goes through the usual approval, client approval and signature.
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground py-2 text-sm">{data?.blockedReason ?? "Loading…"}</p>
          )}
          <DialogFooter>
            {created ? (
              <Button asChild>
                <Link href={`/extensions/amc/${created.submissionId}/edit`}>Open renewal proposal</Link>
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setPreviewOpen(false)} disabled={creating}>
                  Cancel
                </Button>
                <SubmitButton
                  onClick={() => void create()}
                  disabled={!data?.preview}
                  pending={creating}
                  pendingLabel="Creating…"
                  icon={<Repeat className="size-4" />}
                >
                  Create renewal proposal
                </SubmitButton>
              </>
            )}
          </DialogFooter>
        </ActionDialogContent>
      </Dialog>
    </div>
  );
}

/** The outcome so far (Phase 13: DEV-416), and recording one by hand. */
function RenewalOutcomeBlock({
  outcome,
  canRecord,
  onRecord,
}: {
  outcome: ContractRenewalResponse["outcome"];
  canRecord: boolean;
  onRecord: () => void;
}) {
  const current = outcome?.renewal_outcome ?? null;
  const when = [
    outcome?.renewal_outcome_at ? `Recorded ${formatDateTime(outcome.renewal_outcome_at)}` : null,
    outcome?.renewal_reminded_at ? `Reminder sent ${formatDateTime(outcome.renewal_reminded_at)}` : null,
  ].filter(Boolean);
  return (
    <SectionCard
      title="Outcome"
      description="Whether the contract renewed or lapsed."
      icon={<Flag />}
      bodyClassName="px-5 pb-5 grid gap-3"
      action={
        canRecord ? (
          <Button size="sm" variant="outline" onClick={onRecord}>
            <Flag className="size-4" />
            Record outcome
          </Button>
        ) : null
      }
    >
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <span className="text-muted-foreground text-sm">Outcome</span>
        {current ? <RenewalOutcomeBadge outcome={current} /> : <span className="text-muted-foreground text-sm">Not recorded</span>}
      </div>
      {outcome?.renewal_outcome_reason ? <p className="text-sm whitespace-pre-wrap">{outcome.renewal_outcome_reason}</p> : null}
      <p className="text-muted-foreground text-sm">
        {when.length ? when.join(" · ") : "Renewed is recorded when the renewal contract starts; Lapsed when it ends with nothing renewing it."}
      </p>
    </SectionCard>
  );
}

/** Last year on this contract, beside the renewal (Phase 13: DEV-416). */
function PastYearBlock({ pastYear }: { pastYear: ContractRenewalResponse["pastYear"] }) {
  return (
    <SectionCard title="Last year's allowances" description="How much of each service was used this year, to set the renewal against." icon={<ListChecks />} bodyClassName="border-t">
      <DataTable
        columns={allowanceColumns}
        data={pastYear.allowances}
        loading={false}
        rowCount={pastYear.allowances.length}
        pageSize={500}
        currentPage={0}
        onPageChange={noop}
        onPageSizeChange={noop}
        onGlobalFilterChange={noop}
        emptyState={<EmptyState icon={<ListChecks />} title="No counted services" description="Services with a visit or hour allowance show here, with how much was used." />}
      />
    </SectionCard>
  );
}

const noop = () => undefined;

type PastAllowance = ContractRenewalResponse["pastYear"]["allowances"][number];

const allowanceColumns: ColumnDef<PastAllowance>[] = [
  { id: "service", header: "Service", cell: ({ row }) => <span className="font-medium">{row.original.service}</span> },
  {
    id: "used",
    header: "Used",
    cell: ({ row: { original: a } }) => {
      const pct = a.included > 0 ? Math.min(100, Math.round((a.used / a.included) * 100)) : 0;
      return (
        <div className="grid min-w-40 gap-1.5">
          <span className="text-sm tabular-nums">
            <span className="font-medium">{a.used}</span>
            <span className="text-muted-foreground"> of {a.included} used</span>
          </span>
          <Progress value={pct} className="h-1.5 w-full max-w-40" aria-label={`${a.service} usage`} />
        </div>
      );
    },
  },
  {
    id: "state",
    header: "State",
    cell: ({ row: { original: a } }) =>
      a.included > 0 && a.used >= a.included ? (
        <Badge variant="secondary" className="bg-warning/10 text-warning border-0 font-medium">
          Used up
        </Badge>
      ) : (
        <Badge variant="secondary" className="bg-success/10 text-success border-0 font-medium">
          {a.included - a.used} left
        </Badge>
      ),
  },
];

/**
 * Renewal reminders: the Todos this contract would get before it ends.
 * Switched off until the reminder schedule is approved, so this only shows
 * the plan; the thresholds are configuration defaults.
 */
export function RenewalReminders({ contractId, cancelled }: { contractId: string; cancelled: boolean }) {
  const [plan, setPlan] = useState<ReminderPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    let stale = false;
    amcContractsService.reminders(contractId).then(
      (r) => !stale && setPlan(r.reminders),
      (e) => !stale && setError(e instanceof Error ? e.message : "Could not load the reminders."),
    );
    return () => {
      stale = true;
    };
  }, [contractId, attempt]);

  /* Asked first (11 Nov 2026): it acts at once, so it is confirmed like every other step. */
  const create = () =>
    void confirm({ title: "Create the renewal reminders?", description: "Adds this contract's renewal reminders (to the account manager, before the end date) that are not there yet. They go out on their own dates.", confirmText: "Create reminders" }).then((ok) => {
      if (ok) void createNow();
    });
  const createNow = async () => {
    setBusy(true);
    try {
      setPlan((await amcContractsService.createReminders(contractId)).reminders);
      toast.success("Renewal reminders created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the reminders.");
    } finally {
      setBusy(false);
    }
  };

  const missing = plan?.reminders.filter((r) => !r.created).length ?? 0;

  return (
    <SectionCard
      title="Renewal reminders"
      description="Todos for the account manager before the contract ends."
      icon={<BellRing />}
      bodyClassName="px-5 pb-5 space-y-3"
      action={
        plan?.enabled && missing > 0 && !cancelled ? (
          <SubmitButton
            size="sm"
            variant="outline"
            onClick={() => void create()}
            pending={busy}
            pendingLabel="Creating…"
            icon={<BellPlus className="size-4" />}
          >
            Create reminders
          </SubmitButton>
        ) : null
      }
    >
      {error ? (
        <ErrorState
          title="Could not load the reminders"
          message={error}
          onRetry={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : !plan ? (
        <ListSkeleton rows={2} />
      ) : (
        <>
          {plan.reminders.length === 0 ? (
            <EmptyState
              icon={<BellRing />}
              title={cancelled ? "No reminders" : "No reminder dates left"}
              description={cancelled ? "A cancelled contract gets no reminders." : "Every reminder date before the end date has passed."}
              className="rounded-lg border border-dashed p-6"
            />
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border">
              {plan.reminders.map((r) => (
                <li key={r.daysBefore} className="flex items-center gap-3 px-4 py-3">
                  <span className="bg-muted/50 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4">
                    <BellRing />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{r.daysBefore} days before the end</span>
                    <span className="text-muted-foreground block text-xs tabular-nums">{formatContractDate(r.remindOn)}</span>
                  </span>
                  <Badge variant="secondary" className={`border-0 font-medium ${r.created ? "bg-success/10 text-success" : "bg-mist text-ink-soft"}`}>
                    {r.created ? "Todo created" : "Planned"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {!plan.enabled ? (
            <p className="text-muted-foreground bg-muted/40 flex items-start gap-2 rounded-lg px-4 py-3 text-sm">
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>
                Switched off until the reminder schedule ({plan.thresholds.join(", ")} days before the end date) is approved. Nothing is created or emailed.
              </span>
            </p>
          ) : !plan.migrated ? (
            <p className="text-muted-foreground text-xs">Needs migration 20261006110000.</p>
          ) : null}
        </>
      )}
      {confirmDialog}
    </SectionCard>
  );
}
