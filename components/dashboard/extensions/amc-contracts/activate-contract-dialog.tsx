"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionDialogContent, ErrorState, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { DatePickerField } from "@/components/dashboard/extensions/amc/components/date-picker-field";
import { defaultEndDate, formatQuantity, unitWord, validatePeriod } from "@/lib/amc/contracts";
import { AMC_VAT_PERCENT } from "@/lib/amc/pricing";
import { amcContractsService, type ActivationPreview } from "@/modules/amc-contracts/amc-contracts-service";

import { CALL_OUT_LABELS, ENTITLEMENT_TYPE_LABELS, formatContractDate, formatDateTime } from "./contract-status";

/**
 * Activate AMC: turns a signed proposal into an operational contract.
 *
 * Shows everything the contract will hold before anyone confirms: who,
 * where, the signed value and signature, the period and every service with
 * its allowance. The dates start from the proposal's own and can be
 * changed; the rest is copied as signed and never changes afterwards.
 */
export function ActivateContractDialog({
  open,
  onOpenChange,
  submissionId,
  onActivated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submissionId: string;
  onActivated: (contractId: string) => void;
}) {
  const [preview, setPreview] = useState<ActivationPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  /* Date checks only; a server failure is a toast. */
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    setLoadError(null);
    setConfirmed(false);
    setError(null);
    amcContractsService.activationPreview(submissionId).then(
      ({ preview: next }) => {
        if (cancelled) return;
        setPreview(next);
        const start = next.proposedStartDate ?? "";
        setStartDate(start);
        setEndDate(next.proposedEndDate ?? (start ? defaultEndDate(start) ?? "" : ""));
      },
      (e) => !cancelled && setLoadError(e instanceof Error ? e.message : "Could not load the proposal."),
    );
    return () => {
      cancelled = true;
    };
  }, [open, submissionId, attempt]);

  const period = startDate && endDate ? validatePeriod(startDate, endDate) : null;
  const datesChanged =
    !!preview && (startDate !== (preview.proposedStartDate ?? "") || endDate !== (preview.proposedEndDate ?? ""));
  const blocked = !preview
    ? null
    : preview.existingContractId
      ? "This proposal has already been activated."
      : !preview.signed
        ? "Only a signed proposal can be activated."
        : !preview.signedByName || !preview.signedAt
          ? "The proposal has no recorded signature, so it cannot be activated."
          : preview.entitlements.length === 0
            ? "The signed proposal has no services to activate."
            : null;

  const submit = async () => {
    if (!period?.ok) {
      setError(period && !period.ok ? period.error : "Choose the start and end dates.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { contract } = await amcContractsService.activate({ submissionId, startDate, endDate, confirmed: true });
      toast.success(`AMC ${preview?.proposalNumber ?? ""} is now an active contract`);
      onOpenChange(false);
      onActivated(contract.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not activate the contract.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Activate AMC</DialogTitle>
          <DialogDescription>
            Check what the contract will hold. The services, prices and wording the client signed
            are copied onto it and do not change afterwards.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <ErrorState
            title="Could not load the proposal"
            message={loadError}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : !preview ? (
          <div className="space-y-3 py-2" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="grid gap-5 py-2">
            <dl className="grid gap-x-6 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
              <Fact label="Client" value={preview.customerName || "—"} hint={preview.customerRef ? `Client ID ${preview.customerRef}` : undefined} />
              <Fact label="Property" value={preview.propertyLabel || "—"} />
              <Fact
                label="Contract value"
                value={<Money value={preview.grandTotal} />}
                hint={`incl. ${AMC_VAT_PERCENT}% VAT · ${preview.finalPrice.toLocaleString("en-AE", { minimumFractionDigits: 2 })} AED before VAT`}
              />
              <Fact
                label="Signed"
                value={preview.signedByName || "—"}
                hint={preview.signedAt ? formatDateTime(preview.signedAt) : "No signature recorded"}
              />
              <Fact label="Proposal" value={preview.proposalNumber || "—"} />
              <Fact
                label="Account managers"
                value={preview.accountManagers.map((m) => m.name).filter(Boolean).join(", ") || "None named"}
              />
            </dl>

            {blocked ? (
              <div className="border-danger/30 bg-danger/5 text-danger rounded-lg border px-4 py-3 text-sm" role="alert">
                {blocked}{" "}
                {preview.existingContractId ? (
                  <Link href={`/extensions/amc-contracts/${preview.existingContractId}`} className="font-medium underline">
                    Open the contract
                  </Link>
                ) : null}
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="amc-activate-start">Start date</Label>
                      <DatePickerField
                        id="amc-activate-start"
                        value={startDate}
                        onChange={(value) => {
                          setStartDate(value);
                          if (!endDate || endDate <= value) setEndDate(defaultEndDate(value) ?? "");
                        }}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="amc-activate-end">End date</Label>
                      <DatePickerField id="amc-activate-end" value={endDate} onChange={setEndDate} minDate={startDate || undefined} />
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {preview.proposedStartDate
                      ? datesChanged
                        ? `Changed from the proposal's dates (${formatContractDate(preview.proposedStartDate)} to ${formatContractDate(preview.proposedEndDate)}).`
                        : "Taken from the signed proposal's contract dates. Change them if the contract starts on a different day."
                      : "The proposal has no contract dates, so choose them here."}
                  </p>
                </div>

                <div className="grid gap-2">
                  <p className="text-sm font-medium">
                    Services and allowances ({preview.entitlements.length})
                  </p>
                  <ul className="divide-y rounded-lg border text-sm">
                    {preview.entitlements.map((e) => (
                      <li key={e.serviceId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-medium">{e.serviceLabel}</span>
                          <Badge variant="secondary" className="bg-mist text-ink-soft border-0 font-medium">
                            {ENTITLEMENT_TYPE_LABELS[e.entitlementType]}
                          </Badge>
                          {e.callOutClass ? (
                            <Badge variant="outline" className="font-normal">
                              {CALL_OUT_LABELS[e.callOutClass]}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {e.includedQuantity !== null
                            ? `${formatQuantity(e.includedQuantity)} ${unitWord(e.entitlementType, e.includedQuantity)} a year`
                            : e.entitlementType === "unlimited"
                              ? "No limit"
                              : "Covered, not counted"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                  <Checkbox
                    checked={confirmed}
                    onCheckedChange={(value) => setConfirmed(value === true)}
                    className="mt-0.5"
                    aria-label="I have checked these details"
                  />
                  <span>
                    I have checked the client, property, value, dates and services. Activating
                    starts coverage on the start date and cannot be undone (a contract can only be
                    cancelled).
                  </span>
                </label>
              </>
            )}

            {error || (period && !period.ok) ? (
              <p className="text-danger text-sm" role="alert">
                {error ?? (period && !period.ok ? period.error : "")}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <SubmitButton
            onClick={() => void submit()}
            disabled={!preview || !!blocked || !period?.ok || !confirmed}
            pending={busy}
            pendingLabel="Activating…"
            icon={<CalendarCheck2 className="size-4" />}
          >
            Activate contract
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}

function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
      {hint ? <dd className="text-muted-foreground truncate text-xs">{hint}</dd> : null}
    </div>
  );
}
