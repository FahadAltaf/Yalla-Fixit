"use client";

import { useEffect, useState } from "react";
import { CalendarCheck2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ActionDialogContent } from "@/components/dashboard/shared/kaizen-states";
import { DatePickerField } from "@/components/dashboard/extensions/amc/components/date-picker-field";
import { defaultEndDate, validatePeriod } from "@/lib/amc/contracts";
import { amcContractsService } from "@/modules/amc-contracts/amc-contracts-service";

/**
 * Activate AMC: turns a signed proposal into an operational contract.
 *
 * The dates are confirmed here rather than taken silently from the
 * proposal: they decide when coverage starts and ends, and when the
 * contract reads "expiring". The proposal's dates are the starting point.
 */
export function ActivateContractDialog({
  open,
  onOpenChange,
  submissionId,
  proposalNumber,
  customerName,
  proposedStart,
  proposedEnd,
  onActivated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submissionId: string;
  proposalNumber: string;
  customerName: string;
  proposedStart?: string | null;
  proposedEnd?: string | null;
  onActivated: (contractId: string) => void;
}) {
  const [startDate, setStartDate] = useState(proposedStart ?? "");
  const [endDate, setEndDate] = useState(proposedEnd ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStartDate(proposedStart ?? "");
      setEndDate(proposedEnd ?? (proposedStart ? defaultEndDate(proposedStart) ?? "" : ""));
      setError(null);
    }
  }, [open, proposedStart, proposedEnd]);

  const period = startDate && endDate ? validatePeriod(startDate, endDate) : null;

  const submit = async () => {
    if (!period?.ok) {
      setError(period && !period.ok ? period.error : "Choose the start and end dates.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { contract } = await amcContractsService.activate({ submissionId, startDate, endDate });
      toast.success(`AMC ${proposalNumber} is now an active contract`);
      onOpenChange(false);
      onActivated(contract.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not activate the contract.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck2 className="text-brand size-5" />
            Activate AMC
          </DialogTitle>
          <DialogDescription>
            {proposalNumber} · {customerName || "Customer"}. Confirm the contract period. The
            services, prices and wording the client signed are copied onto the contract and do not
            change afterwards.
          </DialogDescription>
        </DialogHeader>

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
        {proposedStart ? (
          <p className="text-muted-foreground text-xs">
            Taken from the proposal; change them if the contract starts on a different day.
          </p>
        ) : null}
        {error || (period && !period.ok) ? (
          <p className="text-destructive text-sm" role="alert">
            {error ?? (period && !period.ok ? period.error : "")}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !period?.ok}>
            {busy ? "Activating…" : "Activate contract"}
          </Button>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
