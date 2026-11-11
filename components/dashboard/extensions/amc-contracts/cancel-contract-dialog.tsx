"use client";

import { useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ActionDialogContent, SubmitButton } from "@/components/dashboard/shared/kaizen-states";
import { amcContractsService } from "@/modules/amc-contracts/amc-contracts-service";

/**
 * Cancels an active contract. Approvers only (the server checks); the
 * reason, who cancelled and when are recorded. The contract and its usage
 * stay visible; new usage is refused and coverage reads "not covered".
 */
export function CancelContractDialog({
  open,
  onOpenChange,
  contractId,
  proposalNumber,
  customerName,
  onCancelled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  proposalNumber: string;
  customerName: string;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setConfirmed(false);
      setError(null);
    }
  }, [open]);

  const reasonOk = reason.trim().length >= 3;

  const submit = async () => {
    if (!reasonOk) {
      setError("Give a reason.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await amcContractsService.cancel(contractId, reason.trim());
      toast.success(`AMC ${proposalNumber} cancelled`);
      onOpenChange(false);
      onCancelled();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel the contract.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <ActionDialogContent busy={busy} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel AMC {proposalNumber}?</DialogTitle>
          <DialogDescription>
            {customerName || "This client"}&apos;s contract stops covering them now, and the reason is recorded.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
            <li>Coverage stops at once: coverage checks answer &ldquo;not covered&rdquo;.</li>
            <li>No more usage can be recorded. Usage already recorded stays visible.</li>
            <li>The contract, its documents and its history are kept.</li>
            <li>This cannot be undone.</li>
          </ul>
          <div className="grid gap-2">
            <Label htmlFor="amc-cancel-reason">Reason (recorded on the contract)</Label>
            <Textarea
              id="amc-cancel-reason"
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(value) => setConfirmed(value === true)}
              className="mt-0.5"
              aria-label="I understand this cannot be undone"
            />
            <span>I understand the contract stops covering this client and this cannot be undone.</span>
          </label>
          {error ? (
            <p className="text-danger text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep contract
          </Button>
          <SubmitButton
            variant="destructive"
            onClick={() => void submit()}
            disabled={!reasonOk || !confirmed}
            pending={busy}
            pendingLabel="Cancelling…"
            icon={<Ban className="size-4" />}
          >
            Cancel contract
          </SubmitButton>
        </DialogFooter>
      </ActionDialogContent>
    </Dialog>
  );
}
