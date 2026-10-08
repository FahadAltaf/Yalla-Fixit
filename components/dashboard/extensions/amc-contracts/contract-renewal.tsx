"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellPlus, BellRing, Repeat } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { SectionCard } from "@/components/dashboard/shared/kaizen";
import { ActionDialogContent, ErrorState, ListSkeleton, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import {
  amcContractsService,
  type ReminderPlan,
  type RenewalOverview,
} from "@/modules/amc-contracts/amc-contracts-service";

import { formatContractDate } from "./contract-status";

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
}: {
  contractId: string;
  proposalNumber: string;
  canRenew: boolean;
  onChanged: () => void;
}) {
  const [data, setData] = useState<RenewalOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ submissionId: string; dropped: string[] } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData((await amcContractsService.renewal(contractId)).renewal);
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

  return (
    <SectionCard
      title="Renewal"
      icon={<Repeat />}
      bodyClassName="px-5 pb-5 space-y-4"
      action={
        data?.renewalProposal ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/extensions/amc/${data.renewalProposal.id}`}>Open renewal proposal</Link>
          </Button>
        ) : canRenew && data?.canCreate ? (
          <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
            <Repeat className="size-4" />
            Create renewal proposal
          </Button>
        ) : null
      }
    >
      {error ? (
        <ErrorState title="Could not load the renewal" message={error} onRetry={() => void load()} />
      ) : !data ? (
        <ListSkeleton rows={3} />
      ) : (
        <>
          <ol className="relative space-y-3 border-l pl-4">
            {steps.map((step) => (
              <li key={step.label} className="relative">
                <span
                  className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 ${step.done ? "border-brand bg-brand" : "border-muted-foreground/40 bg-background"}`}
                  aria-hidden
                />
                <div className="text-muted-foreground text-xs">{step.label}</div>
                <div className="text-sm font-medium">{step.detail}</div>
              </li>
            ))}
          </ol>
          {data.blockedReason && !data.renewalProposal ? (
            <p className="text-muted-foreground text-xs">{data.blockedReason}</p>
          ) : null}
        </>
      )}

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
    </SectionCard>
  );
}

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

  const create = async () => {
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
            <p className="text-muted-foreground text-sm">
              {cancelled ? "A cancelled contract gets no reminders." : "No reminder dates left before the end date."}
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {plan.reminders.map((r) => (
                <li key={r.daysBefore} className="flex items-center justify-between gap-2">
                  <span>
                    {r.daysBefore} days before · <span className="tabular-nums">{formatContractDate(r.remindOn)}</span>
                  </span>
                  <Badge variant="secondary" className={`border-0 font-medium ${r.created ? "bg-success/10 text-success" : "bg-mist text-ink-soft"}`}>
                    {r.created ? "Todo created" : "Planned"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {!plan.enabled ? (
            <p className="text-muted-foreground text-xs">
              Reminders are switched off until the reminder schedule ({plan.thresholds.join(", ")} days
              before the end date, as configured) is approved. Nothing is created or emailed.
            </p>
          ) : !plan.migrated ? (
            <p className="text-muted-foreground text-xs">Needs migration 20261006110000.</p>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
